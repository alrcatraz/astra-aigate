import type { Metadata } from "next";
import ComboPlaygroundClient from "./ComboPlaygroundClient";

export const metadata: Metadata = {
  title: "Astra AI Gate — Combo Playground",
  description: "Simulate combo routing paths visually",
};

export default function ComboPlaygroundPage() {
  return <ComboPlaygroundClient />;
}
