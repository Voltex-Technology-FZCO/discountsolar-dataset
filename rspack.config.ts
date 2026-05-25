import path from "node:path";
import process from "node:process";
import { defineConfig } from "@meteorjs/rspack";
import { TsCheckerRspackPlugin } from "ts-checker-rspack-plugin";

const projectRoot = process.cwd();

export default defineConfig((/* env */) => {
  return {
    plugins: [
      new TsCheckerRspackPlugin({
        typescript: {
          configOverwrite: {
            exclude: [
              "node_modules",
              ".meteor",
              "packages",
              "_build",
              "public/build-chunks",
              "public/build-assets",
            ],
          },
        },
        issue: {
          exclude: [
            { file: "**/node_modules/meteor-rpc/**" },
            { file: "**/node_modules/**" },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "imports/ui"),
      },
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          type: "css",
          use: [{ loader: "postcss-loader" }],
        },
        {
          // meteor-rpc ships raw .ts source — let swc compile it
          test: /\.ts$/,
          include: [path.resolve(projectRoot, "node_modules/meteor-rpc")],
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript" },
              target: "es2020",
            },
          },
        },
      ],
    },
    experiments: {
      css: true,
    },
  };
});
