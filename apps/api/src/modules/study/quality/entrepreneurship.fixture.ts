import type { RetrievedChunk } from '../retrieval.service.js';

const sourceId = 'a4de0e74-bcbb-40b1-90fc-d0e50052995d';
const sourceName = 'Entrepreneurship-Phase5.docx';

function chunk(
  id: string,
  chunkIndex: number,
  sectionTitle: string,
  content: string,
  similarity = 0,
): RetrievedChunk {
  return {
    id,
    sourceId,
    sourceName,
    chunkIndex,
    content,
    pageStart: null,
    pageEnd: null,
    metadata: { sectionTitle, headingPath: [sectionTitle], headingConfidence: 'high' },
    similarity,
  };
}

// Exact representative excerpts copied from the development database on 2026-08-09.
export const entrepreneurshipQualityChunks = [
  chunk(
    '4f6eb27e-c462-4ec2-bb9a-56e651168e90',
    233,
    '2. What is Market Research?',
    'Market research is the systematic process of collecting, analyzing, and interpreting information about customers, competitors, markets, and the business environment to support business decisions. Market research reduces uncertainty and helps entrepreneurs understand whether a business opportunity is viable.',
    0.615,
  ),
  chunk(
    '34aaa4cf-b59c-4447-9cd6-01a7173b8877',
    236,
    '5. Types of Market Research',
    'Primary research involves collecting new data directly from the source. Examples include surveys, interviews, focus groups, observation, and experiments. It is specific and up-to-date but can be expensive and time-consuming. Secondary research uses existing information collected by others, including government reports, academic journals, company reports, and online databases. It is faster and less expensive but may be outdated or not answer a specific business question.',
    0.38,
  ),
  chunk(
    '329026f7-296c-4360-95a8-e093d0ece07a',
    242,
    '11. Rwanda-Based Example',
    'A young entrepreneur wants to sell organic vegetables in Kigali. The entrepreneur surveys 300 households, interviews supermarket managers, observes vegetable markets, and reviews government agriculture reports. Customers are willing to pay slightly more for fresh, pesticide-free vegetables with reliable home delivery. The entrepreneur uses these findings to refine the business model before launching.',
    0.2,
  ),
  chunk(
    '48247fef-ead9-41f2-9b6d-9d68b63da330',
    381,
    'Business Pitch Preparation',
    'A business pitch is a concise, persuasive presentation that explains a business idea, demonstrates its value, and convinces an audience to support or invest in it.',
    0.602,
  ),
  chunk(
    'f23f861b-eb51-4470-b0c6-0dadb4fe6f16',
    382,
    '2. Importance of a Business Pitch',
    'An effective business pitch helps entrepreneurs secure investment, obtain business loans, attract strategic partners, win competitions, acquire customers, recruit talented employees, build credibility, and communicate business opportunities clearly.',
    0.485,
  ),
  chunk(
    '0d283c8b-bc9e-49ba-b7e3-72b974cd2c7d',
    121,
    '2.2 Artificial Intelligence and Automation',
    'Artificial intelligence is becoming an important entrepreneurial tool. Entrepreneurs use AI for customer service, data analysis, marketing, content creation, business forecasting, inventory management, and process automation. AI helps entrepreneurs improve efficiency, decision-making, and innovation.',
    0.289,
  ),
  chunk(
    '0253d9c3-8d78-4f47-a34c-2ffc9df955ed',
    14,
    '3. Evolution of Entrepreneurship',
    'The concept of entrepreneurship has changed over time. Initially, entrepreneurs were mainly viewed as traders and risk-takers. Today, they are seen as innovators, opportunity creators, and agents of economic and social change.',
    0.2,
  ),
  chunk(
    '61f89a94-5b63-4e26-8988-b954c0cb1cc2',
    26,
    'F. 21st Century: Digital and Global Entrepreneurship',
    'Technology has significantly transformed entrepreneurship. Modern entrepreneurs use the internet, artificial intelligence, social media, mobile applications, e-commerce, digital payments, and cloud technology. Entrepreneurs can now manage businesses with customers in different countries.',
    0.2,
  ),
  chunk(
    '7fb21144-b8b8-4501-ac08-1b3a47f7db80',
    30,
    '4. Summary of the Evolution of Entrepreneurship',
    'Ancient and medieval entrepreneurs were viewed as traders; the 17th century emphasized risk-taking; the 18th and 19th centuries emphasized organizing resources; the early 20th century emphasized innovation; the late 20th century emphasized opportunity seeking; and the 21st century emphasizes digital and global entrepreneurship.',
    0.25,
  ),
  chunk(
    'c8732cf9-8c48-44d6-89bf-cc0c6e1a1e98',
    311,
    '6. The Risk Management Process',
    'Entrepreneurs identify, assess, respond to, and monitor business risks. Response strategies include avoidance, reduction, transfer, and acceptance.',
    0.18,
  ),
];

export const entrepreneurshipEvaluationCases = [
  {
    id: 'direct-fact',
    kind: 'direct factual',
    query: 'What is market research?',
    expectedChunkIndexes: [233],
  },
  {
    id: 'comparison',
    kind: 'comparison',
    query: 'Compare primary and secondary market research.',
    expectedChunkIndexes: [236],
  },
  {
    id: 'application',
    kind: 'application/example',
    query: 'How could a Kigali organic vegetable entrepreneur apply market research?',
    expectedChunkIndexes: [242],
  },
  {
    id: 'explanation',
    kind: 'explanation',
    query: 'Why is a business pitch important?',
    expectedChunkIndexes: [381, 382],
  },
  {
    id: 'beginner',
    kind: 'beginner explanation',
    query: 'Explain market research to a complete beginner.',
    expectedChunkIndexes: [233],
  },
  {
    id: 'multi-section',
    kind: 'information across sections',
    query: 'How did entrepreneurship evolve from risk-taking to digital global entrepreneurship?',
    expectedChunkIndexes: [14, 26, 30],
  },
  {
    id: 'arabic',
    kind: 'Arabic comparison',
    query: 'ما الفرق بين البحث الأولي والبحث الثانوي؟',
    expectedChunkIndexes: [236],
  },
  {
    id: 'missing',
    kind: 'missing information',
    query: 'What does this material say about quantum entanglement?',
    expectedChunkIndexes: [],
    missing: true,
  },
] as const;
