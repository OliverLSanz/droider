import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const notices: string[] = [];
const errors: string[] = [];
let corruptReadBack = false;
let saved = false;
const document = {
  languageId: "droider", isDirty: true,
  save: async () => { saved = true; return true; },
};
const moduleLoader = require("node:module");
const originalLoad = moduleLoader._load;
let Manager: typeof import("../src/droidCard").DroidCardManager;
try {
  moduleLoader._load = function (id: string, ...args: unknown[]) {
    if (id === "vscode") return {
      ProgressLocation: { Notification: 1 },
      window: {
        activeTextEditor: { document },
        showInformationMessage: (message: string) => notices.push(message),
        showErrorMessage: (message: string) => errors.push(message),
        withProgress: async (_options: unknown, run: (progress: unknown) => Promise<void>) =>
          run({ report() {} }),
      },
    };
    if (id === "fs") return {
      ...fs,
      readFileSync: (file: fs.PathOrFileDescriptor) => corruptReadBack
        ? Buffer.from("truncated") : fs.readFileSync(file),
    };
    if (id === "child_process") return {
      exec: (_command: string, callback: (error: null) => void) => callback(null),
    };
    return originalLoad.call(this, id, ...args);
  };
  Manager = require("../src/droidCard").DroidCardManager;
} finally {
  moduleLoader._load = originalLoad;
}

async function upload(content: () => Promise<string>, corrupt = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "droid-card-test-"));
  const file = path.join(directory, "droid.ini");
  fs.writeFileSync(file, "previous patch");
  notices.length = 0;
  errors.length = 0;
  saved = false;
  corruptReadBack = corrupt;
  let ejected = false;
  // Avoid starting OS card watchers; exercise the real upload method against
  // an isolated directory and substitute only the physical ejection step.
  const manager = Object.assign(Object.create(Manager.prototype), {
    detectedCardPath: directory,
    resolveContent: content,
    ejectCard: async (card: string) => { assert.equal(card, directory); ejected = true; },
    updateStatusBar() {},
  });
  try {
    await manager.writeAndEject();
    return { written: fs.readFileSync(file, "utf8"), ejected, saved };
  } finally {
    corruptReadBack = false;
    fs.rmSync(directory, { recursive: true });
  }
}

test("upload saves, writes the resolved compiled patch, verifies and ejects", async () => {
  const compiled = "[copy]\ninput = I1\noutput = O1\n";
  const result = await upload(async () => { assert.ok(saved); return compiled; });
  assert.equal(result.written, compiled);
  assert.ok(result.ejected);
  assert.deepEqual(errors, []);
  assert.match(notices[0], /written and verified/);
});

test("a validation failure leaves the previous card patch intact", async () => {
  const result = await upload(async () => { throw new Error("generated .ini is invalid"); });
  assert.equal(result.written, "previous patch");
  assert.equal(result.ejected, false);
  assert.deepEqual(notices, []);
  assert.match(errors[0], /generated .ini is invalid/);
});

test("read-back failure does not eject or report success", async () => {
  const result = await upload(async () => "new patch", true);
  assert.equal(result.ejected, false);
  assert.deepEqual(notices, []);
  assert.match(errors[0], /read-back differs/);
});
