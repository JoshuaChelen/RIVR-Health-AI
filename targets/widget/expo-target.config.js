/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "RivrWidget",
  deploymentTarget: "15.1",
  colors: {
    $accent: "#1FADA6",
    $widgetBackground: { color: "#FFFFFF", darkColor: "#0D1B2A" },
  },
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
