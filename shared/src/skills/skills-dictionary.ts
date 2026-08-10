/**
 * Curated technology skills and their common spellings. This is deliberately
 * approximate: semantic embeddings cover context while this supplies a clear
 * ATS-style coverage signal.
 */
export const SKILLS_DICTIONARY: Record<string, string[]> = {
  javascript: ["javascript", "js"],
  typescript: ["typescript", "ts"],
  java: ["java"],
  python: ["python"],
  go: ["golang", "go language"],
  rust: ["rust"],
  "c#": ["c#", "csharp"],
  react: ["react", "reactjs", "react.js"],
  angular: ["angular", "angularjs"],
  vue: ["vuejs", "vue.js"],
  "node.js": ["node.js", "nodejs"],
  express: ["express", "expressjs"],
  spring: ["spring framework", "spring boot", "springboot"],
  django: ["django"],
  postgresql: ["postgresql", "postgres"],
  mysql: ["mysql"],
  mongodb: ["mongodb", "mongo"],
  redis: ["redis"],
  kafka: ["kafka"],
  rabbitmq: ["rabbitmq"],
  graphql: ["graphql"],
  rest: ["rest api", "rest apis", "restful", "rest services"],
  grpc: ["grpc"],
  docker: ["docker"],
  kubernetes: ["kubernetes", "k8s"],
  terraform: ["terraform"],
  aws: ["aws", "amazon web services"],
  gcp: ["gcp", "google cloud"],
  azure: ["azure"],
  "ci/cd": ["ci/cd", "cicd", "continuous integration"],
  microservices: ["microservices", "microservice"],
  tdd: ["tdd", "test driven development", "test-driven development"],
};

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Return canonical skills present as case-insensitive whole tokens. */
export function detectSkills(text: string): Set<string> {
  const haystack = text.toLocaleLowerCase();
  const found = new Set<string>();
  for (const [canonical, aliases] of Object.entries(SKILLS_DICTIONARY)) {
    for (const alias of aliases) {
      const pattern = new RegExp(
        `(^|[^a-z0-9+#.])${escapeRegExp(alias.toLocaleLowerCase())}([^a-z0-9+#.]|$)`,
      );
      if (pattern.test(haystack)) {
        found.add(canonical);
        break;
      }
    }
  }
  return found;
}
