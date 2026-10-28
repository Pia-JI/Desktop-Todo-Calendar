/** 全局右键/更多菜单状态 */

import { create } from "zustand";
import type { LucideIcon } from "lucide-react";

export interface MenuItem {
  label?: string;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  checked?: boolean;
  onClick?: () => void;
}

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  close: () => void;
}

export const useMenu = create<MenuState>()((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  openMenu: (x, y, items) => set({ open: true, x, y, items }),
  close: () => set({ open: false }),
}));