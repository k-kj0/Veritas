import { setup } from "rivetkit";
import { npc } from "./actors/npc.ts";

export const registry = setup({
  use: { npc },
});
