import { CreatePotForm } from "./CreatePotForm";

export const metadata = { title: "Create pot · Verdict" };

export default function CreatePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Create a pot</h1>
        <p className="text-sm text-muted">Lock USDC until an external condition is reported.</p>
      </div>
      <CreatePotForm />
    </div>
  );
}
