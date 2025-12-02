/**
 * Simple Hello World for Freestyle
 */

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return Response.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  }

  return new Response("Hello from Freestyle!", {
    headers: { "content-type": "text/plain" },
  });
}

export default {
  fetch: handleRequest,
};
