import type { Db } from "../../db/index.js";
import { instanceSettings } from "../../db/schema/index.js";
import { FRIEND_CAP_KEY, getFriendCap } from "./service.js";

export const friendCapState = (db: Pick<Db, "select">) => getFriendCap(db);

export async function setFriendCap(db: Db, cap: number): Promise<void> {
  await db
    .insert(instanceSettings)
    .values({ key: FRIEND_CAP_KEY, value: String(cap) })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value: String(cap) } });
}
