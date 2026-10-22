from robocorp.tasks import task
from pathlib import Path
import os

@task
def smoke():
    message = "Robot Task passed"
    Path("robot-result.txt").write_text(message)
    assert os.environ["ROBOCORP_HOME"] == os.environ["ROBOTS_HOME"]
    print(message)
