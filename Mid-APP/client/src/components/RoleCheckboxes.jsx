// ADMIN is deliberately excluded here: a client's own users are never Admins
// at creation time - that concept only exists for Chief-Admin-side staff,
// picked from CHIEF_ADMIN_ROLE_OPTIONS on the Team screen.
export const ROLE_OPTIONS = ['FRONT_OFFICE', 'LAB_USER', 'MANAGER', 'MASTER_MANAGER'];
export const CHIEF_ADMIN_ROLE_OPTIONS = ['ADMIN', 'MARKETING'];

/** Lets a single user be assigned more than one role at once. */
export default function RoleCheckboxes({ value, onChange, options = ROLE_OPTIONS }) {
  function toggle(role) {
    onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role]);
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', padding: '8px 0' }}>
      {options.map((role) => (
        <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 'normal', marginBottom: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={value.includes(role)}
            onChange={() => toggle(role)}
          />
          {role}
        </label>
      ))}
    </div>
  );
}
