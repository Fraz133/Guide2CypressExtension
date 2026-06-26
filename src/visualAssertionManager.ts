import * as vscode from 'vscode';
import * as path from 'path';

export async function saveVisualBaseline(step: any, testFilePath: string): Promise<void> {
    if (step.action !== 'visualAssert' || !step.snapshotName || !step.snapshotData_base64) {
        throw new Error("Invalid visual assertion step data provided.");
    }

    // 1. Determine the correct Playwright snapshot directory.
    // Example: For a test at '/tests/login.spec.js', the dir is '/tests/login.spec.js-snapshots'.
    const testFileUri = vscode.Uri.file(testFilePath);
    const snapshotDirName = `${path.basename(testFilePath)}-snapshots`;
    const snapshotDirUri = vscode.Uri.joinPath(testFileUri, '..', snapshotDirName);

    // 2. Ensure the snapshot directory exists.
    await vscode.workspace.fs.createDirectory(snapshotDirUri);

    // 3. Define the final path for the baseline image.
    const baselinePathUri = vscode.Uri.joinPath(snapshotDirUri, `${step.snapshotName}.png`);

    // 4. Decode the Base64 data and write the file.
    try {
        const base64Data = step.snapshotData_base64.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        await vscode.workspace.fs.writeFile(baselinePathUri, new Uint8Array(buffer));
        console.log(`[Visuals] ✅ Baseline saved for Playwright: ${baselinePathUri.fsPath}`);

    } catch (error: any) {
        console.error(`[Visuals] ❌ Failed to save baseline image: ${error.message}`);
        throw new Error(`Failed to save baseline for ${step.snapshotName}.`);
    }
}