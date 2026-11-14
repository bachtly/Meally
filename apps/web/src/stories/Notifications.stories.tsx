import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotificationsSection } from "../features/push/NotificationsSection";
import type { PushEnv } from "../features/push/push";
import { installMockApi } from "./mockApi";

/** A pretend browser, so the stories never show a real permission prompt. */
function fakeEnv(o: { ios?: boolean; standalone?: boolean; permission?: NotificationPermission; subscribed?: boolean }): PushEnv {
  const sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/story",
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/story", keys: { p256dh: "pk", auth: "au" } }),
    unsubscribe: async () => true,
  } as unknown as PushSubscription;
  let current = o.subscribed ? sub : null;
  const reg = { pushManager: { getSubscription: async () => current, subscribe: async () => (current = sub) } } as unknown as ServiceWorkerRegistration;
  return {
    nav: {
      userAgent: o.ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" : navigator.userAgent,
      platform: o.ios ? "iPhone" : "Linux",
      maxTouchPoints: 0,
      standalone: o.standalone,
      serviceWorker: { getRegistration: async () => reg, ready: Promise.resolve(reg) },
    } as unknown as Navigator,
    win: {
      matchMedia: () => ({ matches: !!o.standalone }),
      PushManager: class {},
      Notification: { permission: o.permission ?? "default", requestPermission: async () => "granted" },
    } as unknown as Window & typeof globalThis,
  };
}

function Frame({ env, on }: { env: PushEnv; on?: boolean }) {
  try {
    if (on) localStorage.setItem("meally:push-subscription", "sub1");
    else localStorage.removeItem("meally:push-subscription");
  } catch {
    /* storage blocked in a preview */
  }
  installMockApi({
    "GET /push/key": [200, { publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" }],
    "POST /push/subscriptions": [201, { id: "sub1" }],
    "DELETE /push/subscriptions/*": [204, null],
  });
  return (
    <div className="flex max-w-xl flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <NotificationsSection env={env} />
    </div>
  );
}

const meta = { title: "Snap loop/5 Notifications", component: Frame } satisfies Meta<typeof Frame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = { args: { env: fakeEnv({}) } };
export const On: Story = { args: { env: fakeEnv({ subscribed: true, permission: "granted" }), on: true } };
export const Blocked: Story = { args: { env: fakeEnv({ permission: "denied" }) } };
export const IPhoneNotInstalled: Story = { name: "iPhone, not on the Home Screen", args: { env: fakeEnv({ ios: true }) } };
