interface ProblemOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly detail: string;
  readonly status: number;
  readonly title: string;
}

export function problem({ headers, detail, status, title }: ProblemOptions): Response {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Content-Type", "application/problem+json");

  return new Response(
    JSON.stringify({
      type: "about:blank",
      title,
      status,
      detail,
    }),
    { status, headers: responseHeaders },
  );
}
