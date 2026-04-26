export interface OutputFormatter<TInput = unknown> {
  readonly format: string;
  render(input: TInput): string;
}
