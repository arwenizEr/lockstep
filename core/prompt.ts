/**
 * Resolve an ad-hoc prompt from the available sources, in precedence order:
 * a positional argument, then --file contents, then piped stdin. Throws when
 * none yields non-empty text. Used by `lockstep ask` so a prompt can be typed,
 * read from a file, or piped — no cases file required.
 */
export function resolvePrompt(opts: {
  arg?: string;
  file?: string;
  stdin?: string;
}): string {
  const raw = opts.arg ?? opts.file ?? opts.stdin ?? "";
  const text = raw.trim();
  if (!text) {
    throw new Error(
      "No prompt provided. Pass it as an argument, with --file <path>, or pipe it via stdin."
    );
  }
  return text;
}
