import { Fragment, type ReactNode } from "react";

interface ScriptCopyEntry {
  description: ReactNode;
  subtitle: ReactNode;
  placeholder: string;
}

export const SCRIPT_COPY: Record<"maintenance" | "dev", ScriptCopyEntry> = {
  maintenance: {
    description: "Script that runs after git pull in case new dependencies were added.",
    subtitle: (
      <Fragment>
        We execute this from <code className="text-11px">/root/workspace</code>, where your repositories are cloned. For
        example, <code className="text-11px">cd my-repo && npm install</code> installs dependencies inside
        <code className="text-11px">/root/workspace/my-repo</code>.
      </Fragment>
    ),
    placeholder: `# e.g.
bun install
npm install
uv sync
pip install -r requirements.txt
etc.`,
  },
  dev: {
    description: "Script that starts the development server.",
    subtitle: (
      <Fragment>
        Runs from <code className="text-11px">/root/workspace</code> as well, so reference repos with relative
        paths—e.g. <code className="text-11px">cd web && npm run dev</code>.
      </Fragment>
    ),
    placeholder: `# e.g.
npm run dev
bun dev
python manage.py runserver
rails server
cargo run
etc.`,
  },
};
