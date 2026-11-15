/**
 * Discipline by the first 3 digits of the NPTEL course id.
 *
 * Derived on 2026-11-15 from the live listing https://nptel.ac.in/courses: all 3,484 course cards were read
 * (link id + the discipline label printed on the card) and, per prefix, the most frequent label was kept.
 * Labels are exactly as the site prints them. Counts are "plurality / cards with that prefix".
 *
 * The prefix is NOT a perfect predictor: 61 of 3,484 cards (1.75%) carry a different label than their
 * prefix's majority (e.g. 117xxxxxx: 108 Electronics & Communication vs 21 Electrical). Weakest prefixes:
 * 121 (10/16), 117 (108/129), 102 (137/142). A prefix absent from the listing (e.g. 125) maps to null.
 */
export const DISCIPLINE_BY_PREFIX: Readonly<Record<string, string>> = {
  "101": "Aerospace Engineering", // 90/90
  "102": "Biotechnology", // 137/142
  "103": "Chemical Engineering", // 200/201
  "104": "Chemistry And Biochemistry", // 131/131
  "105": "Civil Engineering", // 303/307
  "106": "Computer Science And Engineering", // 306/308
  "107": "Engineering Design", // 36/36
  "108": "Electrical Engineering", // 283/287
  "109": "Humanities And Social Sciences", // 323/328
  "110": "Management", // 216/221
  "111": "Mathematics", // 243/245
  "112": "Mechanical Engineering", // 392/394
  "113": "Metallurgy And Material Science", // 124/125
  "114": "Ocean Engineering", // 35/35
  "115": "Physics", // 140/141
  "116": "Textile Engineering", // 29/29
  "117": "Electronics & Communication Engineering", // 108/129
  "118": "Nanotechnology", // 5/5
  "119": "Atmospheric Science", // 4/4
  "120": "Environmental Science", // 5/5
  "121": "General", // 10/16
  "122": "Basic Courses-Sem 1 And 2", // 38/38
  "123": "Mining Engineering", // 10/10
  "124": "Architecture", // 45/45
  "126": "Agriculture", // 38/39
  "127": "Multidisciplinary", // 92/93
  "128": "Special Series", // 33/33
  "129": "Law", // 29/29
  "130": "Economics", // 18/18
};

/** Discipline for a 9-digit course id, or null when the 3-digit prefix is not in the mapping. */
export function disciplineFromId(courseId: string): string | null {
  return DISCIPLINE_BY_PREFIX[courseId.slice(0, 3)] ?? null;
}
