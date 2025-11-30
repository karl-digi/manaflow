import { describe, expect, it } from "vitest";

import { chooseFrameworkFromPackageJson } from "./framework-detection";

describe("chooseFrameworkFromPackageJson", () => {
  it("detects Vite when scripts run the vite binary", () => {
    const preset = chooseFrameworkFromPackageJson({
      devDependencies: { vite: "^5.0.0" },
      scripts: {
        dev: "vite dev --host",
      },
    });

    expect(preset).toBe("vite");
  });

  it("does not treat vitest scripts as Vite", () => {
    const preset = chooseFrameworkFromPackageJson({
      devDependencies: { vitest: "^1.0.0" },
      scripts: {
        test: "vitest run",
      },
    });

    expect(preset).toBeNull();
  });

  it("prefers CRA when react-scripts is present even with vitest", () => {
    const preset = chooseFrameworkFromPackageJson({
      dependencies: { "react-scripts": "5.0.1" },
      devDependencies: { vitest: "^1.0.0" },
      scripts: {
        start: "react-scripts start",
        test: "vitest run",
      },
    });

    expect(preset).toBe("cra");
  });

  it("prefers Vue when vue-cli is present even with vitest", () => {
    const preset = chooseFrameworkFromPackageJson({
      dependencies: { vue: "^3.4.0" },
      devDependencies: { vitest: "^1.0.0" },
      scripts: {
        dev: "vue-cli-service serve",
        test: "vitest run",
      },
    });

    expect(preset).toBe("vue");
  });
});
