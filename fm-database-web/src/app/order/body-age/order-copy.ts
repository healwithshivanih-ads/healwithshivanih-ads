/**
 * Every word a buyer reads on the body age order page. APPROVED by Shivani on 21 Nov 2026,
 * word for word as it stands. Any change to a sentence here needs her yes again.
 * `fields.voucher` and `voucherNote` (the Rs 500 voucher) were added and approved by her the same evening.
 * `pin.yes` and `pin.no` (the PIN code check, 22 Nov 2026) are NOT yet approved: she must say yes before the
 * page goes live with them.
 * Rules the words follow: "body age report" and "test", never the product's internal name or the brand name;
 * the laboratory is never named; nothing is called urgent; no programme, plan length or programme price; no
 * "free"; every session is online. A test (order-copy.test.ts) fails on any of these.
 */
export const COPY = {
  title: "Body age report",
  lead: "A blood test at home, and a written report that tells you your body age and what to do about it.",
  how: [
    "You order and pay here.",
    "Someone comes to your home in the morning to take a blood sample.",
    "Fast for 10 to 12 hours before the sample. Plain water is fine.",
    "Your report reaches you by email as a PDF within 5 days of the sample.",
  ],
  kinds: {
    standard: {
      name: "Body age report",
      about: "Your body age, worked out from your blood, and a plain-words read of your heart, sugar, liver, thyroid, kidneys and blood count.",
    },
    deeper: {
      name: "Body age report with deeper tests",
      about: "Everything in the body age report, plus vitamins, minerals, iron, the free thyroid hormones and heavy metals.",
    },
  },
  forTwo: "For two people",
  forTwoAbout: "Two people at one address, sampled on the same morning.",
  priceNote: "The price includes the blood collection at home.",
  sections: { who: "Who is the test for?", second: "The second person", visit: "Your home visit" },
  fields: {
    full_name: "Full name",
    date_of_birth: "Date of birth",
    sex: "Sex (laboratory ranges differ)",
    female: "Female",
    male: "Male",
    email: "Email (your report is sent here)",
    phone: "WhatsApp number",
    address: "Full address for the home visit",
    pincode: "PIN code",
    preferred_date: "Preferred morning",
    preferred_slot: "Preferred time",
    notes: "Anything we should know (optional)",
    voucher: "Voucher code (if you have one)",
  },
  voucherNote: "From the body age check. ₹500 comes off when you pay, for one person's report.",
  pin: {
    yes: "The home visit reaches this PIN code.",
    no: "The home visit does not reach this PIN code yet. Nothing has been charged. Message us on WhatsApp and we will tell you what is possible.",
  },
  slots: { morning: "Early morning (7 to 9)", late_morning: "Late morning (9 to 11)" },
  visitNote: "We confirm the day and time with you on WhatsApp before anyone comes.",
  consent: "I am 18 or over. Everyone named here has agreed to this test, and to their results being used to prepare this report.",
  pay: "Pay",
  paying: "Opening secure payment…",
  confirming: "Confirming your payment…",
  doneTitle: "Thank you. Your order is in.",
  done: [
    "We will message you on WhatsApp to confirm the day and time of your home visit.",
    "Fast for 10 to 12 hours before the sample. Plain water is fine.",
    "Your report comes by email within 5 days of the sample.",
  ],
  testBanner: "TEST MODE. No real money is taken and no laboratory visit is booked.",
} as const;
