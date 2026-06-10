/**
 * Dosha self-assessment quiz — the lifelong-frame questionnaire that DERIVES
 * the client's prakruti (constitution). Single source of truth for the quiz:
 * the intake form renders these, and the stored answers ({key: "vata"|"pitta"
 * |"kapha"}) land on Client.dosha_self_assessment. The Python suggester only
 * consumes the answer dict (tallies the picks) — it does not need the question
 * text — so there's no cross-language duplication.
 *
 * LIFELONG FRAME: every prompt asks "what have you ALWAYS been like", not "how
 * are you right now" — prakruti is the stable baseline, distinct from vikruti
 * (current imbalance, which the AI infers from current symptoms).
 *
 * Each option's `value` is the dosha it scores. Single-pick per question; the
 * tally naturally yields a single- or dual-dosha constitution.
 */

export type DoshaValue = "vata" | "pitta" | "kapha";

export interface DoshaQuizOption {
  value: DoshaValue;
  label: string;
}
export interface DoshaQuizQuestion {
  key: string;
  prompt: string;
  options: [DoshaQuizOption, DoshaQuizOption, DoshaQuizOption];
}

export const DOSHA_QUIZ: DoshaQuizQuestion[] = [
  {
    key: "body_frame",
    prompt: "Your body build, for as long as you can remember, is…",
    options: [
      { value: "vata", label: "Thin / light — find it hard to gain weight" },
      { value: "pitta", label: "Medium / athletic — gain and lose fairly easily" },
      { value: "kapha", label: "Solid / larger — gain easily, hard to lose" },
    ],
  },
  {
    key: "skin_lifelong",
    prompt: "Your skin has always tended to be…",
    options: [
      { value: "vata", label: "Dry, thin, rough or cool" },
      { value: "pitta", label: "Warm, reddish, sensitive, freckles/moles" },
      { value: "kapha", label: "Thick, smooth, oily, cool & soft" },
    ],
  },
  {
    key: "hair_lifelong",
    prompt: "Your hair is naturally…",
    options: [
      { value: "vata", label: "Dry, frizzy or brittle" },
      { value: "pitta", label: "Fine, early greying or thinning" },
      { value: "kapha", label: "Thick, wavy, oily, lustrous" },
    ],
  },
  {
    key: "appetite",
    prompt: "Your appetite is usually…",
    options: [
      { value: "vata", label: "Irregular — varies a lot day to day" },
      { value: "pitta", label: "Strong & sharp — irritable if a meal is late" },
      { value: "kapha", label: "Steady but mild — can easily skip a meal" },
    ],
  },
  {
    key: "bowel_lifelong",
    prompt: "Your digestion / bowels, by nature, tend toward…",
    options: [
      { value: "vata", label: "Dry, hard or irregular — prone to constipation/gas" },
      { value: "pitta", label: "Loose, frequent, urgent — can feel a burning" },
      { value: "kapha", label: "Slow, heavy but regular" },
    ],
  },
  {
    key: "weather_dislike",
    prompt: "The weather you most dislike is…",
    options: [
      { value: "vata", label: "Cold, dry, windy" },
      { value: "pitta", label: "Hot, intense sun" },
      { value: "kapha", label: "Cold, damp, heavy" },
    ],
  },
  {
    key: "sleep_lifelong",
    prompt: "Your sleep, by nature, is…",
    options: [
      { value: "vata", label: "Light, easily interrupted" },
      { value: "pitta", label: "Moderate, generally sound" },
      { value: "kapha", label: "Deep & long — hard to wake" },
    ],
  },
  {
    key: "energy_lifelong",
    prompt: "Your energy tends to come in…",
    options: [
      { value: "vata", label: "Bursts, then I tire quickly" },
      { value: "pitta", label: "Intense, focused, driven" },
      { value: "kapha", label: "Steady & enduring — slow to start" },
    ],
  },
  {
    key: "mind_lifelong",
    prompt: "Your mind, at baseline, is…",
    options: [
      { value: "vata", label: "Quick, creative, restless" },
      { value: "pitta", label: "Sharp, focused, determined" },
      { value: "kapha", label: "Calm, steady, slower to change" },
    ],
  },
  {
    key: "under_stress",
    prompt: "Under stress you most often become…",
    options: [
      { value: "vata", label: "Anxious, worried, scattered" },
      { value: "pitta", label: "Irritable, critical, angry" },
      { value: "kapha", label: "Withdrawn, quiet, comfort-eat" },
    ],
  },
  {
    key: "weight_lifelong",
    prompt: "Across your adult life, your weight has…",
    options: [
      { value: "vata", label: "Stayed low — hard to gain" },
      { value: "pitta", label: "Been fairly stable — gains & loses easily" },
      { value: "kapha", label: "Crept up — gains easily, hard to shift" },
    ],
  },
  {
    key: "temperament",
    prompt: "Your natural pace / temperament is…",
    options: [
      { value: "vata", label: "Fast, talkative, enthusiastic" },
      { value: "pitta", label: "Precise, intense, purposeful" },
      { value: "kapha", label: "Slow, measured, easy-going" },
    ],
  },
];
