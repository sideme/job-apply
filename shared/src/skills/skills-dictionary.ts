/**
 * Curated technology skills and their common spellings. This is deliberately
 * approximate: semantic embeddings cover context while this supplies a clear
 * ATS-style coverage signal.
 */
export const SKILLS_DICTIONARY: Record<string, string[]> = {
  // Languages
  javascript: ["javascript", "js"],
  typescript: ["typescript", "ts"],
  java: ["java"],
  python: ["python"],
  go: ["golang", "go language"],
  rust: ["rust"],
  "c#": ["c#", "csharp"],
  "c++": ["c++"],
  kotlin: ["kotlin"],
  scala: ["scala"],
  ruby: ["ruby"],
  php: ["php"],
  swift: ["swift"],
  groovy: ["groovy"],
  sql: ["sql"],
  bash: ["bash", "shell scripting"],

  // JVM / backend frameworks
  spring: [
    "spring framework",
    "spring boot",
    "springboot",
    "spring cloud",
    "spring mvc",
    "spring security",
    "spring webflux",
  ],
  hibernate: ["hibernate"],
  jpa: ["jpa"],
  quarkus: ["quarkus"],
  micronaut: ["micronaut"],
  netty: ["netty"],
  ".net": [".net", "dotnet", "asp.net"],
  django: ["django"],
  flask: ["flask"],
  fastapi: ["fastapi"],
  rails: ["rails", "ruby on rails"],
  laravel: ["laravel"],
  "node.js": ["node.js", "nodejs"],
  express: ["express", "expressjs"],
  "nest.js": ["nest.js", "nestjs"],

  // Frontend
  react: ["react", "reactjs", "react.js"],
  angular: ["angular", "angularjs"],
  vue: ["vuejs", "vue.js"],
  "next.js": ["next.js", "nextjs"],
  svelte: ["svelte", "sveltekit"],
  redux: ["redux"],
  html: ["html", "html5"],
  css: ["css", "css3"],
  sass: ["sass", "scss"],
  tailwind: ["tailwind", "tailwindcss"],
  webpack: ["webpack"],
  vite: ["vite"],

  // Datastores
  postgresql: ["postgresql", "postgres"],
  mysql: ["mysql"],
  mariadb: ["mariadb"],
  "sql server": ["sql server", "mssql"],
  oracle: ["oracle", "oracle db", "oracle database"],
  sqlite: ["sqlite"],
  mongodb: ["mongodb", "mongo"],
  redis: ["redis"],
  cassandra: ["cassandra"],
  elasticsearch: ["elasticsearch", "elastic search"],
  dynamodb: ["dynamodb"],
  neo4j: ["neo4j"],
  snowflake: ["snowflake"],
  bigquery: ["bigquery"],

  // Messaging / streaming / data
  kafka: ["kafka"],
  rabbitmq: ["rabbitmq"],
  activemq: ["activemq"],
  spark: ["apache spark", "spark"],
  flink: ["flink"],
  hadoop: ["hadoop"],
  airflow: ["airflow"],

  // APIs / protocols
  graphql: ["graphql"],
  rest: ["rest api", "rest apis", "restful", "rest services"],
  grpc: ["grpc"],
  soap: ["soap"],
  websocket: ["websocket", "websockets"],
  protobuf: ["protobuf", "protocol buffers"],
  swagger: ["swagger", "openapi"],

  // Cloud / infra / ops
  docker: ["docker"],
  kubernetes: ["kubernetes", "k8s"],
  helm: ["helm"],
  openshift: ["openshift"],
  istio: ["istio"],
  terraform: ["terraform"],
  ansible: ["ansible"],
  nginx: ["nginx"],
  aws: ["aws", "amazon web services"],
  gcp: ["gcp", "google cloud"],
  azure: ["azure"],
  prometheus: ["prometheus"],
  grafana: ["grafana"],
  datadog: ["datadog"],
  linux: ["linux"],

  // CI/CD & tooling
  "ci/cd": ["ci/cd", "cicd", "continuous integration"],
  jenkins: ["jenkins"],
  "github actions": ["github actions"],
  "gitlab ci": ["gitlab ci", "gitlab-ci"],
  argocd: ["argocd", "argo cd"],
  git: ["git"],
  maven: ["maven"],
  gradle: ["gradle"],

  // Testing / practices
  microservices: ["microservices", "microservice"],
  tdd: ["tdd", "test driven development", "test-driven development"],
  ddd: ["ddd", "domain driven design", "domain-driven design"],
  junit: ["junit"],
  mockito: ["mockito"],
  jest: ["jest"],
  cypress: ["cypress"],
  selenium: ["selenium"],
  playwright: ["playwright"],
  pytest: ["pytest"],
  oauth: ["oauth", "oauth2"],
  jwt: ["jwt"],
  agile: ["agile"],
  scrum: ["scrum"],
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
