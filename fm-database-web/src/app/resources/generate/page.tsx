import { InfoPackGeneratorForm } from "./info-pack-form";

export default function GenerateInfoPackPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Generate Evidence Brief</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Search PubMed for recent clinical evidence on a topic and synthesise it into a
          readable, client-friendly information pack. Saved automatically to{" "}
          <strong>Resources</strong>.
        </p>
      </div>
      <InfoPackGeneratorForm />
    </div>
  );
}
