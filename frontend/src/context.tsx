import { createContext, useContext } from "react";
import type { CurrentUser } from "./api";
export const UserContext = createContext<CurrentUser | null>(null);
export const useUser = () => useContext(UserContext)!;
export const FeedbackContext = createContext<(message: string) => void>(
  () => {},
);
export const useFeedback = () => useContext(FeedbackContext);
