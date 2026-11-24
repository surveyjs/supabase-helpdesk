'use client';

/**
 * Product (category) filter for the customer ticket lists (#120). Lives inside
 * the page's GET search form and submits it on change; without JS the form's
 * Search button applies it.
 */
export function CategorySelect({
  categories,
  current,
}: {
  categories: { id: string; name: string }[];
  current: string;
}) {
  if (categories.length === 0) return null;
  return (
    <select
      name="category"
      defaultValue={current}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      aria-label="Filter by product"
      className="form-input w-auto max-w-[14rem] text-sm"
      data-testid="category-filter"
    >
      <option value="">All products</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
