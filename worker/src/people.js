export function peopleRoutes(kit) {
  const listPeople = async (c) => {
    kit.requireEmptyBody(c);
    kit.requireManager(c);
    const { results } = await c.env.DB.prepare(
      `SELECT name, email, MAX(manager) AS manager FROM codes
        WHERE revoked_at IS NULL AND EXISTS (SELECT 1 FROM json_each(codes.hosts_json) WHERE value = ?1)
        GROUP BY lower(email) ORDER BY lower(name), lower(email)`,
    )
      .bind(c.scope.host)
      .all();
    const people = new Map(results.map((r) => [r.email.toLowerCase(), { name: r.name, email: r.email.toLowerCase(), manager: Boolean(r.manager) }]));
    for (const email of kit.managersOf(c.env)) {
      const known = people.get(email);
      if (known) known.manager = true;
      else people.set(email, { name: "", email, manager: true });
    }
    return kit.json(200, { people: [...people.values()] });
  };
  return [["GET", /^\/people$/, listPeople]];
}
