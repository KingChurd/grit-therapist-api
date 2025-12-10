// api/therapists.js
// Vercel serverless function for GRIT therapist search using NPI Registry (CommonJS version)

const MENTAL_HEALTH_TAXONOMY_CODES = [
  "101YP2500X", // Professional counselor
  "101YM0800X", // Mental health counselor
  "101YA0400X", // Addiction counselor
  "103TC0700X", // Clinical psychologist
  "1041C0700X", // Clinical social worker
  "106H00000X", // Marriage & family therapist
];

module.exports = async (req, res) => {
  // Allow GET only
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { zip, focus } = req.query || {};

  if (!zip || !/^\d{5}$/.test(zip)) {
    res.statusCode = 400;
    return res.json({ error: "zip (5-digit) is required" });
  }

  try {
    const params = new URLSearchParams({
      version: "2.1",
      postal_code: zip,
      country_code: "US",
      enumeration_type: "NPI-1",
      limit: "100",
    });

    const url = `https://npiregistry.cms.hhs.gov/api/?${params.toString()}`;

    const npiResponse = await fetch(url);
    if (!npiResponse.ok) {
      throw new Error(`NPI API error: ${npiResponse.status}`);
    }

    const data = await npiResponse.json();
    const results = data.results || [];

    const cleaned = results
      .map((r) => {
        const basic = r.basic || {};
        const addresses = r.addresses || [];
        const taxonomies = r.taxonomies || [];

        const practice =
          addresses.find((a) => a.address_purpose === "LOCATION") ||
          addresses[0] ||
          {};

        const mhTaxonomies = taxonomies.filter((tx) =>
          MENTAL_HEALTH_TAXONOMY_CODES.includes(tx.code)
        );
        if (mhTaxonomies.length === 0) return null;

        const fullName =
          basic.name ||
          [basic.first_name, basic.last_name].filter(Boolean).join(" ");

        return {
          npi: r.number,
          name: fullName,
          credential: basic.credential || null,
          gender: basic.gender || null,
          city: practice.city || null,
          state: practice.state || null,
          postal_code: practice.postal_code || null,
          phone: practice.telephone_number || null,
          taxonomies: mhTaxonomies.map((tx) => ({
            code: tx.code,
            desc: tx.desc,
          })),
        };
      })
      .filter(Boolean);

    const focusLower = (focus || "").toLowerCase();
    const scored = cleaned
      .map((t) => {
        let score = 0;

        if (focusLower) {
          const combinedTaxDesc = t.taxonomies
            .map((tx) => tx.desc.toLowerCase())
            .join(" ");
          if (combinedTaxDesc.includes("addiction") && focusLower.includes("addiction")) score += 2;
          if (combinedTaxDesc.includes("family") && focusLower.includes("marriage")) score += 2;
          if (combinedTaxDesc.includes("mental health")) score += 1;
        }

        return { ...t, score };
      })
      .sort((a, b) => b.score - a.score);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.statusCode = 200;
    return res.json({
      query: { zip, focus: focus || null },
      count: scored.length,
      results: scored,
    });
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    return res.json({ error: "Internal error", detail: err.message });
  }
};

