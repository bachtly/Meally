import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HIDDEN_MS, KEEP_MS, openCamera, releaseCamera, stopCamera } from "./camera";

let stop: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  stop = vi.fn();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop, readyState: "live" }] }) as unknown as MediaStream);
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }));
});

afterEach(() => {
  stopCamera();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reuses the live stream instead of asking again", async () => {
  const a = await openCamera("environment");
  releaseCamera(KEEP_MS);
  vi.advanceTimersByTime(KEEP_MS - 1);
  expect(await openCamera("environment")).toBe(a);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
});

it("shares one request between callers while the browser asks", async () => {
  const [a, b] = await Promise.all([openCamera("environment"), openCamera("environment")]);
  expect(a).toBe(b);
  expect(getUserMedia).toHaveBeenCalledTimes(1);
});

it("stops the stream once the delay passes", async () => {
  await openCamera("environment");
  releaseCamera(HIDDEN_MS);
  vi.advanceTimersByTime(HIDDEN_MS);
  expect(stop).toHaveBeenCalledTimes(1);
  await openCamera("environment");
  expect(getUserMedia).toHaveBeenCalledTimes(2);
});

it("stops at once when told, and on a flip", async () => {
  await openCamera("environment");
  await openCamera("user");
  expect(stop).toHaveBeenCalledTimes(1);
  stopCamera();
  expect(stop).toHaveBeenCalledTimes(2);
});

it("asks again when the browser ended the track", async () => {
  getUserMedia.mockImplementationOnce(async () => ({ getTracks: () => [{ stop, readyState: "ended" }] }) as unknown as MediaStream);
  await openCamera("environment");
  await openCamera("environment");
  expect(getUserMedia).toHaveBeenCalledTimes(2);
});

it("releases a stream that arrives after the camera was stopped", async () => {
  const p = openCamera("environment");
  stopCamera();
  await expect(p).rejects.toThrow("superseded");
  expect(stop).toHaveBeenCalledTimes(1);
});
