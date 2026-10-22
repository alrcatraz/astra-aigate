/**
 * Tunnel status/notice types for the endpoint page (Cloudflared, Tailscale
 * and Ngrok phases), extracted from EndpointPageClient.tsx.
 */

export type CloudflaredTunnelPhase =
  "unsupported" | "not_installed" | "stopped" | "starting" | "running" | "error";

export type CloudflaredTunnelStatus = {
  supported: boolean;
  installed: boolean;
  managedInstall: boolean;
  installSource: string | null;
  binaryPath: string | null;
  running: boolean;
  pid: number | null;
  publicUrl: string | null;
  apiUrl: string | null;
  targetUrl: string;
  phase: CloudflaredTunnelPhase;
  lastError: string | null;
  logPath: string;
};

export type TailscaleTunnelPhase =
  "unsupported" | "not_installed" | "needs_login" | "stopped" | "running" | "error";

export type TailscaleTunnelStatus = {
  supported: boolean;
  installed: boolean;
  managedInstall: boolean;
  installSource: string | null;
  binaryPath: string | null;
  loggedIn: boolean;
  daemonRunning: boolean;
  running: boolean;
  enabled: boolean;
  tunnelUrl: string | null;
  apiUrl: string | null;
  phase: TailscaleTunnelPhase;
  platform: string;
  brewAvailable: boolean;
  lastError: string | null;
  pid: number | null;
};

export type NgrokTunnelPhase =
  "unsupported" | "not_installed" | "stopped" | "needs_auth" | "starting" | "running" | "error";

export type NgrokTunnelStatus = {
  supported: boolean;
  installed: boolean;
  running: boolean;
  publicUrl: string | null;
  apiUrl: string | null;
  targetUrl: string;
  phase: NgrokTunnelPhase;
  lastError: string | null;
};

export type TunnelNotice = {
  type: "success" | "error" | "info";
  message: string;
};

export type EndpointTunnelVisibility = {
  showCloudflaredTunnel: boolean;
  showTailscaleFunnel: boolean;
  showNgrokTunnel: boolean;
};
