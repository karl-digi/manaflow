const FREESTYLE_API_KEY = process.env.FREESTYLE_API_KEY;
if (!FREESTYLE_API_KEY) {
  throw new Error("FREESTYLE_API_KEY is not set");
}
const result = await fetch("https://api.freestyle.sh/v1/vms", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${FREESTYLE_API_KEY}`,
  },
  body: JSON.stringify({
    idleTimeoutSeconds: 0,
    // ports: [
    //   {
    //     port: 443,
    //     targetPort: 3000,
    //   },
    // ],
    // waitForReadySignal: true,
    // readySignalTimeoutSeconds: 0,
    workdir: "/root",
    memory: 16,
    persistence: {
      priority: 5,
      type: "sticky",
    },
  }),
});

const data = await result.json();
console.log(data);

async function exec({ vmId, command }: { vmId: string; command: string }) {
  const result = await fetch(
    `https://api.freestyle.sh/v1/vms/${vmId}/exec-await`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FREESTYLE_API_KEY}`,
      },
      body: JSON.stringify({ command, terminal: null }),
    }
  );
  return await result.json();
}

console.log(await exec({ vmId: data.id, command: "echo 'Hello, World!'" }));

export {};
