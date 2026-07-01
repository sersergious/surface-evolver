// Evaluated on each build runner, so process.platform/arch reflect the target.
const os   = process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux";
const arch = process.arch === "arm64" ? "arm64" : "x64";
const ext  = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
const lib  = `libse-${os}-${arch}.${ext}`;   // staged by scripts/build-native.ts (preBuild)

export default {
  app: {
    name: "Surface Evolver",
    identifier: "com.skuzmin.surfaceevolver",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/main/src/index.ts",
    },
    views: {
      main: {
        entrypoint: "src/views/index.html",
      },
    },
    // Bundled into Resources/app: the headless native lib (per platform), the
    // .fe datafile library, and the worker script (spawned via `bun run`).
    copy: {
      [`build-native/${lib}`]:      `native/${lib}`,
      "fe":                          "fe",
      "src/main/src/se-worker.ts":   "worker/se-worker.ts",
    },
    // Keep native libs as real files if asar packing is ever enabled.
    asarUnpack: ["native/*", "*.dylib", "*.dll", "*.so"],
    mac: {
      entitlements: "default",
      createDmg: true,
    },
    win: {},
  },
  // Builds the headless libse for the current runner before bundling.
  scripts: {
    preBuild: "./scripts/build-native.ts",
  },
};
