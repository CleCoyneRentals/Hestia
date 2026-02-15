export const ITEM_CATEGORIES = [
  { value: 'appliance', label: 'Appliance', icon: 'refrigerator' },
  { value: 'furniture', label: 'Furniture', icon: 'couch' },
  { value: 'hvac', label: 'HVAC System', icon: 'thermometer' },
  { value: 'plumbing', label: 'Plumbing', icon: 'droplet' },
  { value: 'electrical', label: 'Electrical', icon: 'zap' },
  { value: 'structural', label: 'Structural', icon: 'home' },
  { value: 'outdoor', label: 'Outdoor/Landscaping', icon: 'tree' },
  { value: 'safety', label: 'Safety/Security', icon: 'shield' },
  { value: 'electronics', label: 'Electronics', icon: 'monitor' },
  { value: 'other', label: 'Other', icon: 'box' },
] as const;

export const CATEGORY_VALUES = ITEM_CATEGORIES.map((c) => c.value) as unknown as readonly [
  (typeof ITEM_CATEGORIES)[number]['value'],
  ...(typeof ITEM_CATEGORIES)[number]['value'][],
];
