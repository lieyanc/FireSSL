import { z } from "zod"

import type { Translate } from "@/i18n"

export function subjectSchema(t: Translate) {
  const text = (max: number) => z.string().trim().max(max, t("certs.form.tooLong", { max }))
  return z.object({
    organization: text(64),
    organizationalUnit: text(64),
    country: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{2})?$/, t("certs.form.countryInvalid")),
    province: text(128),
    locality: text(128),
  })
}

export type SubjectValues = z.infer<ReturnType<typeof subjectSchema>>
