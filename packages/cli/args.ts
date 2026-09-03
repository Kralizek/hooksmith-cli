/** Supported output formats for bounded CLI reports. */
export type ReportFormat = "table" | "json" | "tsv";

/** Parsed options for the `hooksmith run` command. */
export interface RunCliOptions {
  eventFiles: string[];
  configFile: string;
  format: ReportFormat;
  plan: boolean;
  allowEmpty: boolean;
}
