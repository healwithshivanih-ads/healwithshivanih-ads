/**
 * Hinglish on the phone's own cards (coach, 21 Nov 2026: "Hinglish replies
 * are fine"). The model is told to answer in the client's language; the cards
 * the phone writes itself are fixed text, so a question typed in Hinglish gets
 * each fixed line swapped for its Hinglish version here. Text not in the table
 * (the coach's own guide lines, meal names) stays as written.
 */
import type { AskCard } from "./ask-card";

const HINDI_WORDS =
  /\b(kya|kyu|kyun|kaise|kaisa|main|mai|mujhe|mera|meri|mere|hai|hain|hoon|hu|nahi|nahin|nhi|sakti|sakta|sakte|khana|kha|khau|khaun|lena|lu|loon|pee|piyu|abhi|aaj|kal|raat|subah|shaam|thoda|zyada|bahut|chahiye|wala|wali|aur|bhi|toh|ke|ki|ko|se|gayi|gaya|chalega|karu|karun|kar)\b/g;

/** Three or more Hindi words in Roman letters. */
export function isHinglish(q: string): boolean {
  return (q.toLowerCase().match(HINDI_WORDS) ?? []).length >= 3;
}

const HI: Record<string, string> = {
  // urgent
  "Please act now": "Abhi dhyan dijiye",
  "This may be an emergency": "Yeh emergency ho sakti hai",
  "Call 112 or go to your nearest hospital now.": "Abhi 112 call kijiye ya sabse paas ke hospital jaiye.",
  "Message your coach once you are safe.": "Safe hone ke baad apne coach ko message kijiye.",
  "Please read this": "Ise padhiye",
  "You do not have to carry this alone": "Aapko yeh akele nahi uthana hai",
  "If you are in danger right now, call 112 or go to your nearest hospital.": "Agar aap abhi khatre mein hain, toh 112 call kijiye ya sabse paas ke hospital jaiye.",
  "Your coach will want to know. Message your coach whenever you are ready.": "Aapke coach jaanna chahenge. Jab ready hon, apne coach ko message kijiye.",
  // hand-offs
  "One for your coach": "Yeh aapke coach ke liye",
  "This involves a medicine, so your coach answers it personally. Send it to your coach?": "Isme dawai ki baat hai, toh aapke coach khud jawab denge. Coach ko bhej dein?",
  "This plan is built from your own tests and history, so I can only answer for you. Shall I pass the question to your coach?": "Yeh plan aapke apne tests aur history se bana hai, toh yahan sirf aapke liye jawab milta hai. Sawaal coach ko bhej dein?",
  "Your coach goes through your results with you, so the first time you see them is together. Shall I ask your coach for you?": "Aapke results coach aapke saath dekhenge. Coach se pooch loon?",
  "How supplements go together is your coach's call. Send this to your coach?": "Supplements saath mein kaise lene hain, yeh coach batayenge. Coach ko bhej dein?",
  "A question about how your weight is changing is one for your coach. Send it to your coach?": "Weight badalne ka sawaal coach ke liye hai. Coach ko bhej dein?",
  "If you also feel unwell, see a doctor today.": "Agar tabiyat bhi theek nahi lag rahi, toh aaj doctor ko dikhaiye.",
  "Your coach will want to answer this personally. Send it to your coach?": "Iska jawab aapke coach khud dena chahenge. Coach ko bhej dein?",
  "If it feels severe or sudden, see a doctor today.": "Agar yeh tez ya achanak hai, toh aaj doctor ko dikhaiye.",
  "Changing, adding or skipping a supplement is your coach's call. Send this to your coach?": "Supplement badalna, jodna ya chhodna coach ka faisla hai. Coach ko bhej dein?",
  "That is a question about your health picture, so your coach answers it personally. Send it to your coach?": "Yeh aapki health ke baare mein hai, toh coach khud jawab denge. Coach ko bhej dein?",
  "I don't have an answer to that in your plan. Shall I pass it to your coach?": "Iska jawab aapke plan mein nahi hai. Coach ko bhej dein?",
  "Your coach replies within 24 hours.": "Aapke coach 24 ghante mein jawab dete hain.",
  // missed capsule
  "From your coach": "Aapke coach se",
  "No worries": "Koi baat nahi",
  "Just take the next one at its usual time. There's no need to take two to make up for it.": "Agli wali apne time par le lijiye. Do ek saath lene ki zaroorat nahi hai.",
  "Your phone can remind you at each supplement time.": "Aapka phone har supplement ke time par yaad dila sakta hai.",
  "Yes, remind me": "Haan, yaad dilao",
  "Tell me how": "Kaise karein, batao",
  // alcohol
  "Best to skip it for now": "Abhi ke liye na lein",
  "It's best to skip alcohol while you're on this plan.": "Is plan ke dauraan alcohol na lena hi behtar hai.",
  "If you'd like to talk it through, your coach can help.": "Is par baat karni ho, toh coach madad karenge.",
  "One, slowly, with food": "Ek, dheere, khane ke saath",
  "If you do have a drink, have one, slowly, with food, and water alongside.": "Agar lena ho, toh ek hi, dheere, khane ke saath, aur saath mein paani.",
  "Your coach will go through alcohol with you.": "Alcohol ke baare mein coach aapse baat karenge.",
  // buttons and labels
  "Message my coach": "Coach ko message",
  "Your whole day": "Aapka poora din",
  "Your record": "Aapka record",
  "See recipe": "Recipe dekhein",
  "The whole guide": "Poori guide",
  "Ask my coach": "Coach se poochein",
  "Not on your list yet": "Abhi aapki list mein nahi hai",
  "From your plan": "Aapke plan se",
  "Quick answer": "Jaldi jawab",
  "A quick answer from your plan. Your coach will look at your question too.": "Aapke plan se jaldi jawab. Aapke coach bhi aapka sawaal dekhenge.",
};

const t = (s: string | undefined): string | undefined => (s === undefined ? s : (HI[s] ?? s));

/** The card in Hinglish where the table has the line; unchanged otherwise. */
export function inLanguageOf(q: string, card: AskCard): AskCard {
  if (!isHinglish(q)) return card;
  return {
    ...card,
    src: t(card.src) ?? card.src,
    heading: t(card.heading),
    lines: card.lines.map((l) => t(l) ?? l),
    note: t(card.note),
    buttons: card.buttons?.map((b) => ({ ...b, label: t(b.label) ?? b.label })),
  };
}
