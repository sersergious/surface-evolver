import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/surface-evolver/',
    component: ComponentCreator('/surface-evolver/', 'c39'),
    routes: [
      {
        path: '/surface-evolver/',
        component: ComponentCreator('/surface-evolver/', 'a13'),
        routes: [
          {
            path: '/surface-evolver/',
            component: ComponentCreator('/surface-evolver/', '7fc'),
            routes: [
              {
                path: '/surface-evolver/api/files',
                component: ComponentCreator('/surface-evolver/api/files', 'a64'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/api/jobs',
                component: ComponentCreator('/surface-evolver/api/jobs', '24d'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/api/sessions',
                component: ComponentCreator('/surface-evolver/api/sessions', '37a'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/api/simulation',
                component: ComponentCreator('/surface-evolver/api/simulation', 'd70'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/api/websocket',
                component: ComponentCreator('/surface-evolver/api/websocket', '5e9'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/architecture/data-flow',
                component: ComponentCreator('/surface-evolver/architecture/data-flow', '1f2'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/architecture/dependencies',
                component: ComponentCreator('/surface-evolver/architecture/dependencies', 'fa1'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/architecture/overview',
                component: ComponentCreator('/surface-evolver/architecture/overview', '4a1'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/components/CliPane',
                component: ComponentCreator('/surface-evolver/components/CliPane', 'c1f'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/components/FilePane',
                component: ComponentCreator('/surface-evolver/components/FilePane', 'c23'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/components/store-and-hooks',
                component: ComponentCreator('/surface-evolver/components/store-and-hooks', '6bf'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/components/ViewerPane',
                component: ComponentCreator('/surface-evolver/components/ViewerPane', '312'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/contributing/code-style',
                component: ComponentCreator('/surface-evolver/contributing/code-style', 'ae4'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/contributing/workflow',
                component: ComponentCreator('/surface-evolver/contributing/workflow', '28f'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/gui-dev/implementation',
                component: ComponentCreator('/surface-evolver/gui-dev/implementation', '4ea'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/gui-dev/test-infra',
                component: ComponentCreator('/surface-evolver/gui-dev/test-infra', 'a67'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/modules/backend-core',
                component: ComponentCreator('/surface-evolver/modules/backend-core', 'f2c'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/modules/backend-routers',
                component: ComponentCreator('/surface-evolver/modules/backend-routers', 'fb0'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/modules/c-api',
                component: ComponentCreator('/surface-evolver/modules/c-api', '2fa'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/modules/c-engine',
                component: ComponentCreator('/surface-evolver/modules/c-engine', '443'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/modules/fe-datafiles',
                component: ComponentCreator('/surface-evolver/modules/fe-datafiles', 'abd'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/modules/python-binding',
                component: ComponentCreator('/surface-evolver/modules/python-binding', '916'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/setup/deploy-railway',
                component: ComponentCreator('/surface-evolver/setup/deploy-railway', '979'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/setup/environment-variables',
                component: ComponentCreator('/surface-evolver/setup/environment-variables', 'be7'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/setup/installation',
                component: ComponentCreator('/surface-evolver/setup/installation', '4eb'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/setup/running-locally',
                component: ComponentCreator('/surface-evolver/setup/running-locally', 'ca1'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/surface-evolver/',
                component: ComponentCreator('/surface-evolver/', '29c'),
                exact: true,
                sidebar: "docs"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];
