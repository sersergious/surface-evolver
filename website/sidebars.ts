import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "README",
    {
      type: "category",
      label: "Architecture",
      collapsed: false,
      items: [
        "architecture/overview",
        "architecture/data-flow",
        "architecture/dependencies",
      ],
    },
    {
      type: "category",
      label: "Setup",
      items: [
        "setup/installation",
        "setup/environment-variables",
        "setup/running-locally",
        "setup/deploy-railway",
      ],
    },
    {
      type: "category",
      label: "Modules",
      items: [
        "modules/c-engine",
        "modules/c-api",
        "modules/python-binding",
        "modules/backend-core",
        "modules/backend-routers",
        "modules/fe-datafiles",
      ],
    },
    {
      type: "category",
      label: "REST API",
      items: [
        "api/sessions",
        "api/simulation",
        "api/files",
        "api/jobs",
        "api/websocket",
      ],
    },
    {
      type: "category",
      label: "Frontend",
      items: [
        "components/FilePane",
        "components/CliPane",
        "components/ViewerPane",
        "components/store-and-hooks",
      ],
    },
    {
      type: "category",
      label: "GUI Dev",
      items: ["gui-dev/implementation", "gui-dev/test-infra"],
    },
    {
      type: "category",
      label: "Contributing",
      items: ["contributing/code-style", "contributing/workflow"],
    },
  ],
};

export default sidebars;
