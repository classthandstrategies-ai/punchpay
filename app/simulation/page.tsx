import type { Metadata } from "next";
import SimulationApp from "@/components/SimulationApp";

export const metadata: Metadata = {
  title: "PunchPay · Offline simulation",
  description: "Six fixture-backed PunchPay scenarios that run entirely in the browser. No PayPal or Claude calls; nothing here is a real transaction."
};
export default function SimulationPage() { return <SimulationApp />; }
