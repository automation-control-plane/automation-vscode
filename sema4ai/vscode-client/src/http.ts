import * as fs from "fs";
import { createHash } from "crypto";
import { CancellationToken, Progress } from "vscode";

import { sleep, Timing } from "./time";
import { OUTPUT_CHANNEL } from "./channel";
import { xhr, XHRResponse } from "./requestLight";

export type DownloadProgress = {
    message?: string;
    increment?: number;
};

export async function downloadWithProgress(
    url: string,
    progress: Progress<DownloadProgress>,
    token: CancellationToken,
    location: string,
    expectedSha256?: string
) {
    // Downloads can go wrong (so, retry a few times before giving up).
    const maxTries = 3;
    let timing: Timing = new Timing();

    OUTPUT_CHANNEL.appendLine("Downloading from: " + url);
    for (let i = 0; i < maxTries; i++) {
        function onProgress(currLen: number, totalLen: number) {
            if (timing.elapsedFromLastMeasurement(300) || currLen == totalLen) {
                currLen /= 1024 * 1024;
                totalLen /= 1024 * 1024;
                let currProgress = (currLen / totalLen) * 100;
                let msg: string =
                    "Downloaded: " +
                    currLen.toFixed(1) +
                    "MB of " +
                    totalLen.toFixed(1) +
                    "MB (" +
                    currProgress.toFixed(1) +
                    "%)";
                if (i > 0) {
                    msg = "Attempt: " + (i + 1) + " - " + msg;
                }
                progress.report({ message: msg });
                OUTPUT_CHANNEL.appendLine(msg);
            }
        }

        try {
            let response: XHRResponse = await xhr({
                "url": url,
                "onProgress": onProgress,
            });
            if (response.status == 200) {
                // Ok, we've been able to get it.
                // Note: only write to file after we get all contents to avoid
                // having partial downloads.
                OUTPUT_CHANNEL.appendLine("Finished downloading in: " + timing.getTotalElapsedAsStr());
                OUTPUT_CHANNEL.appendLine("Writing to: " + location);
                progress.report({ message: "Finished downloading (writing to file)." });
                const contents = Buffer.concat(response.responseData);
                if (expectedSha256 && createHash("sha256").update(contents).digest("hex") !== expectedSha256) {
                    throw new Error("SHA-256 verification failed for " + url);
                }
                fs.writeFileSync(location, contents, { mode: 0o744, flag: "wx" });

                // If we don't sleep after downloading, the first activation seems to fail on Windows and Mac
                // (EBUSY on Windows, undefined on Mac).
                await sleep(200);

                return location;
            } else {
                throw Error(
                    "Unable to download from " +
                        url +
                        ". Response status: " +
                        response.status +
                        "Response message: " +
                        response.responseText
                );
            }
        } catch (error) {
            OUTPUT_CHANNEL.appendLine("Error downloading (" + i + " of " + maxTries + "). Error: " + error.message);
            if (i == maxTries - 1) {
                return undefined;
            }
        }
    }
}
