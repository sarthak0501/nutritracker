"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { assertExpectedUser } from "@/lib/expected-user";
import {
  completeWeeklyCheckInForUser,
  deleteMealPresetForUser,
  logLibraryMealForUser,
  proposeSharedMealForUser,
  respondMealProposalForUser,
  saveMealPresetForUser,
  setCooperativeCheckInForUser,
  updateMealPresetForUser,
} from "@/lib/meal-library";
import type {
  LogLibraryMealInput,
  MealSelection,
  MealSource,
  ProposeSharedMealInput,
  RespondMealProposalInput,
} from "@/lib/meal-types";

function refreshMeals() {
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/buddy");
}

export async function saveMealPreset(input: MealSelection & { name: string; source: MealSource; requestId?: string; expectedUserId: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const result = await saveMealPresetForUser(user.id, input);
  refreshMeals();
  return result;
}

export async function updateMealPreset(input: { id: string; name?: string; pinned?: boolean; expectedUserId: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  await updateMealPresetForUser(user.id, input);
  refreshMeals();
}

export async function deleteMealPreset(input: { id: string; expectedUserId: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  await deleteMealPresetForUser(user.id, input.id);
  refreshMeals();
}

export async function logLibraryMeal(input: LogLibraryMealInput & { expectedUserId: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const result = await logLibraryMealForUser(user.id, input);
  refreshMeals();
  return result;
}

export async function proposeSharedMeal(input: ProposeSharedMealInput & { expectedUserId: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const result = await proposeSharedMealForUser(user.id, input);
  refreshMeals();
  return result;
}

export async function respondMealProposal(input: RespondMealProposalInput & { expectedUserId: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const result = await respondMealProposalForUser(user.id, input);
  refreshMeals();
  return result;
}

export async function setCooperativeCheckIn(input: { enabled: boolean; expectedUserId: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  await setCooperativeCheckInForUser(user.id, input.enabled);
  refreshMeals();
}

export async function completeWeeklyCheckIn(input: { expectedUserId: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  await completeWeeklyCheckInForUser(user.id);
  refreshMeals();
}
