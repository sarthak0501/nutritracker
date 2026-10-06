import type { AmountUnit, MealType } from "@prisma/client";
import type { Nutrients } from "@/lib/nutrition";

/** Clients send references, never trusted nutrition or another account's entries. */
export type MealSource =
  | { kind: "saved"; id: string }
  | { kind: "entries"; entryIds: string[] };

export type MealItem = {
  id: string;
  foodId: string;
  name: string;
  amount: number;
  unit: AmountUnit;
  portionLabel: string;
  nutrients: Nutrients;
  isEstimated: boolean;
};

export type LibraryMeal = {
  id: string;
  name: string;
  mealType: MealType;
  date?: string;
  pinned?: boolean;
  items: MealItem[];
  source: MealSource;
};

export type MealProposalView = {
  id: string;
  name: string;
  date: string;
  mealType: MealType;
  items: MealItem[];
  sender: { id: string; username: string };
  recipient: { id: string; username: string };
  status: "PENDING" | "ACCEPTED" | "DECLINED";
};

export type MealLibraryData = {
  saved: LibraryMeal[];
  recent: LibraryMeal[];
  pending: MealProposalView[];
  sent: MealProposalView[];
  buddy: { id: string; username: string } | null;
  checkIn: {
    enabled: boolean;
    weekStart: string;
    completed: boolean;
    /** Buddy participation is disclosed only after both people opt in. */
    buddyEnabled: boolean;
    buddyCompleted: boolean | null;
  };
};

export type MealSelection = {
  multiplier?: number;
  selectedItemIds?: string[];
};

export type LogLibraryMealInput = MealSelection & {
  requestId: string;
  source: MealSource;
  date: string;
  mealType: string;
};

export type ProposeSharedMealInput = LogLibraryMealInput & {
  recipientId: string;
  name?: string;
};

export type RespondMealProposalInput = MealSelection & {
  proposalId: string;
  action: "accept" | "decline";
  date?: string;
  mealType?: string;
};
