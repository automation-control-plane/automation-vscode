"""
This script is meant to be called as:

python run_and_save_pid.py <file_to_write_pid> <executable> <executable_args, ...>

After the launch is made, <file_to_write_pid> should have the <pid>\n written.
"""

from typing import List, Optional
import subprocess
import sys
import os
import json


def main(file_to_write_pid: str, args: list[str]):
    """
    The first argument is where we should write the pid to. All the
    other arguments are used to make the launch.
    """
    # The existing terminal wrapper already owns/reaps this exact child. Pass
    # its actual completion to DAP without parsing terminal output or replacing
    # RCC execution. This private control variable is not inherited by the task.
    exit_file = os.environ.pop("AUTOMATION_DAP_EXIT_FILE", None)
    p = subprocess.Popen(args, shell=sys.platform == "win32")

    with open(file_to_write_pid, "w") as stream:
        stream.write(str(p.pid))
        stream.write("\n")
        stream.flush()

    returncode = p.poll()
    while returncode is None:
        try:
            p.wait()
        except:
            pass
        returncode = p.poll()

    if exit_file:
        try:
            with open(exit_file, "x", encoding="utf-8") as stream:
                json.dump({"pid": p.pid, "exit_code": returncode}, stream)
                stream.write("\n")
        except OSError:
            # Reporting failure must not alter the task's real return status.
            print("Automation: unable to record process completion.", file=sys.stderr)
    return returncode


if __name__ == "__main__":
    # Remove current script from args.
    args = sys.argv[1:]
    sys.exit(main(args[0], args[1:]))


def wait_for_pid_in_file(target_file: str, timeout: float = 20) -> int:
    import time
    from pathlib import Path

    initial_time = time.time()

    p = Path(target_file)

    def read_pid() -> int | None:
        if p.exists():
            txt = p.read_text("utf-8")
            if txt.endswith("\n"):
                return int(txt.strip())
        return None

    failures_reading = 0
    while True:
        pid = None
        try:
            pid = read_pid()
        except:
            failures_reading += 1
            if failures_reading > 2:
                raise

        if pid is not None:
            return pid
        if timeout is not None and (time.time() - initial_time > timeout):
            error_msg = f"Unable to read pid in {target_file} in {timeout} seconds"
            raise TimeoutError(error_msg)

        time.sleep(1.0 / 15.0)
