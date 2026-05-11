const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const marker = "# RIVR: Work around fmt 11.0.2 consteval failures on Apple clang.";

const rubyPatch = `
    ${marker}
    fmt_base_h = File.join(Pod::Config.instance.sandbox_root, 'fmt/include/fmt/base.h')
    if File.exist?(fmt_base_h)
      fmt_source = File.read(fmt_base_h)
      fmt_source = fmt_source.gsub(
        "#elif defined(__apple_build_version__) && __apple_build_version__ < 14000029L\\n#  define FMT_USE_CONSTEVAL 0  // consteval is broken in Apple clang < 14.",
        "#elif defined(__apple_build_version__)\\n#  define FMT_USE_CONSTEVAL 0  // consteval is broken in this Apple clang path."
      )
      File.chmod(0644, fmt_base_h)
      File.write(fmt_base_h, fmt_source)
    end
`;

function insertFmtPatch(podfile) {
  if (podfile.includes(marker)) {
    return podfile;
  }

  const postInstallCall = /react_native_post_install\([\s\S]*?\n    \)/;
  if (!postInstallCall.test(podfile)) {
    throw new Error("Could not find react_native_post_install in ios/Podfile");
  }

  return podfile.replace(postInstallCall, (match) => `${match}${rubyPatch}`);
}

module.exports = function withIosFmtXcodeFix(config) {
  return withDangerousMod(config, [
    "ios",
    (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, "Podfile");
      const podfile = fs.readFileSync(podfilePath, "utf8");
      fs.writeFileSync(podfilePath, insertFmtPatch(podfile));
      return modConfig;
    },
  ]);
};
