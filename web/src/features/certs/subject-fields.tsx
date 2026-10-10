import type { FieldValues, Path, UseFormReturn } from "react-hook-form"

import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { SubjectValues } from "@/features/certs/subject-schema"
import { useI18n } from "@/i18n"

const FIELDS = [
  ["organization", "Acme Inc."],
  ["organizationalUnit", "IT"],
  ["country", "US"],
  ["province", "California"],
  ["locality", "San Francisco"],
] as const

/** Optional distinguished-name fields besides the common name. */
export function SubjectFields<V extends FieldValues & SubjectValues>({
  form,
  idPrefix,
}: {
  form: UseFormReturn<V>
  idPrefix: string
}) {
  const { t } = useI18n()
  const errors = form.formState.errors as Partial<
    Record<keyof SubjectValues, { message?: string }>
  >
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map(([name, placeholder]) => (
        <Field key={name} data-invalid={!!errors[name] || undefined}>
          <FieldLabel htmlFor={`${idPrefix}-${name}`}>
            {t(`certs.subject.${name}`)}
          </FieldLabel>
          <Input
            id={`${idPrefix}-${name}`}
            placeholder={placeholder}
            maxLength={name === "country" ? 2 : undefined}
            aria-invalid={!!errors[name]}
            {...form.register(name as Path<V>)}
          />
          <FieldError errors={[errors[name]]} />
        </Field>
      ))}
    </div>
  )
}
