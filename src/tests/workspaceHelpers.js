import { screen, fireEvent, waitFor, within } from "@testing-library/react";

/** Draw a box on the page workspace image. `purpose`: "entry" or "annotation". Overlay is 1000 x 1400 px. */
export async function drawBox(dialog, { purpose = "entry", from = [80, 182], to = [950, 1022] } = {}) {
  fireEvent.click(await within(dialog).findByRole("button", { name: purpose === "entry" ? "Draw entry box" : "Draw stamp / margin note" }));
  const overlay = within(dialog).getByTestId("region-overlay");
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1400, right: 1000, bottom: 1400 });
  const before = within(dialog).queryAllByTestId("region-box").length;
  fireEvent.pointerDown(overlay, { clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(overlay, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(overlay, { clientX: to[0], clientY: to[1], pointerId: 1 });
  await waitFor(() => expect(within(dialog).getAllByTestId("region-box").length).toBe(before + 1));
}

/** Click an AI button, wait for the cost confirmation, and click Send. Returns the confirmation text. */
export async function confirmAndSend(dialog, buttonName) {
  const button = await within(dialog).findByRole("button", { name: buttonName });
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  const box = await within(dialog).findByTestId("ai-confirm");
  const text = box.textContent;
  fireEvent.click(within(box).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(within(dialog).queryByTestId("ai-confirm")).toBeNull());
  return text;
}

export const openReview = async (fileName) => {
  fireEvent.click(screen.getByRole("button", { name: `Review text of ${fileName}` }));
  const dialog = await screen.findByTestId("text-review");
  await waitFor(() => expect(within(dialog).getByRole("img")).toBeTruthy());
  return dialog;
};
