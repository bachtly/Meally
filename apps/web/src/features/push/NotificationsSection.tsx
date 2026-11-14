import { BellOff } from "lucide-react";
import { Switch } from "../../ui";
import { usePushSwitch, type PushEnv } from "./push";

/**
 * Settings: one switch for push on this device (new Snaps from Friends and Reactions to yours). Hidden when the
 * browser can't do push or the server has no keys; iPhone gets the Home Screen steps instead (AC-4.6).
 */
export function NotificationsSection({ env }: { env?: PushEnv }) {
  const { status, busy, error, turnOn, turnOff } = usePushSwitch(env);
  if (status === "unsupported" || status === "unconfigured") return null;

  if (status === "ios-install") {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-sunken p-4">
        <p className="font-semibold">Add Meally to your Home Screen first</p>
        <ol className="list-decimal pl-5 text-sm leading-relaxed">
          <li>Tap Share in Safari.</li>
          <li>Tap Add to Home Screen.</li>
          <li>Open Meally from your Home Screen and turn notifications on here.</li>
        </ol>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <p role="status" className="flex items-start gap-3 rounded-lg border border-line bg-raised p-4 text-sm">
        <BellOff className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        Notifications are blocked in your browser settings. Allow them there, then come back.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 rounded-lg border border-line bg-raised p-4">
        <label htmlFor="push-switch" className="flex flex-1 flex-col">
          <span className="font-medium">New Snaps and Reactions</span>
          <span className="text-sm text-muted">On this device</span>
        </label>
        <Switch
          id="push-switch"
          checked={status === "on"}
          disabled={busy || status === "loading"}
          onCheckedChange={(on) => void (on ? turnOn() : turnOff())}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
