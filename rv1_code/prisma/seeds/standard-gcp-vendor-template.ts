// =============================================================================
// Standard GCP Vendor Questionnaire — canonical template seed (D-003)
//
// PIQC-internal templates are intentionally sponsor-name-free. The auditor
// substitutes the actual sponsor name during external polish (Word/Google Docs)
// after export. Question text uses "Sponsor" as a generic placeholder.
//
// This seed defines version 1 of the canonical template. Edits over time
// should publish a new version (versionNumber: 2, …) — never mutate existing
// version rows, since prior audits are pinned to historical versions.
//
// Section 5.3 ("Other") is intentionally NOT seeded here. 5.3.x slots are
// generated per-instance from VendorServiceMappingObject entries by
// lib/questionnaires.ts → generateAddenda().
// =============================================================================

import { PrismaClient, QuestionAnswerType } from "@prisma/client";
import { TemplateSeed } from "@/lib/types/questionnaire";

const N = QuestionAnswerType.NARRATIVE;
const Y = QuestionAnswerType.YES_NO_QUALIFY;
const E = QuestionAnswerType.EVIDENCE_REQUEST;
const L = QuestionAnswerType.LIST;
const NUM = QuestionAnswerType.NUMERIC;

export const standardGcpVendorTemplate: TemplateSeed = {
  slug: "standard-gcp-vendor",
  name: "Standard GCP Vendor Questionnaire",
  description:
    "Canonical GCP vendor questionnaire used as the starting point for every audit. Sponsor-agnostic by design — the auditor adds the sponsor name during external polish on export. Auditor pre-fills from public web research; vendor completes only PENDING items.",
  isDefault: true,
  versionNumber: 1,
  notes: "Initial seed of the standard GCP vendor questionnaire structure.",
  questions: [
    // -----------------------------------------------------------------------
    // 1. GENERAL INFORMATION — Vendor Background
    // -----------------------------------------------------------------------
    q("1.1.1", "1.1", "Vendor Background", "Provide a general overview of the company. Please describe any affiliations you may have (ECs/IRBs, Hospitals, other).", N, false, 1),
    q("1.1.2", "1.1", "Vendor Background", "Is your company publicly traded?", Y, false, 2),
    q("1.1.3", "1.1", "Vendor Background", "Describe the ownership and financial structure of the company.", N, false, 3),
    q("1.1.4", "1.1", "Vendor Background", "Please provide a copy of your organizational chart.", E, true, 4),
    q("1.1.5", "1.1", "Vendor Background", "List current number of Employees and Contract Personnel.", NUM, false, 5),
    q("1.1.6", "1.1", "Vendor Background", "Provide the number and locations of your offices/facilities.", L, false, 6),
    q("1.1.7", "1.1", "Vendor Background", "List the Quality Scheme accreditations your company currently holds which are applicable to the proposed activities (e.g., GLP, ISO 9001:2008, CAP/CLIA accreditation, etc.).", L, true, 7),
    q("1.1.8", "1.1", "Vendor Background", "Have there been any changes to your organization within the last three (3) years? (i.e. financial structure, changes in departments, reporting relationships, etc.)", Y, false, 8),
    q("1.1.9", "1.1", "Vendor Background", "Is your organization experienced in conducting studies involving the therapeutic area under study and/or the study design, or subject population?", Y, false, 9),
    q("1.1.10", "1.1", "Vendor Background", "How many active studies is your organization currently managing?", NUM, false, 10),

    // 1.2 Scope of Work (note: source template skips 1.2.5)
    q("1.2.1", "1.2", "Scope of Work", "Which company locations will perform the proposed activities for the Sponsor? Please indicate if these are headquarters, regional or country offices.", L, false, 11),
    q("1.2.2", "1.2", "Scope of Work", "Which location(s) would be the most appropriate for the Sponsor's QA to visit if an on-site audit is deemed necessary?", N, false, 12),
    q("1.2.3", "1.2", "Scope of Work", "Will any of the proposed activities be performed by sub-contractors? If so, list the sub-contractors, their scope of work and their locations.", Y, false, 13),
    q("1.2.4", "1.2", "Scope of Work", "If your company uses sub-contractors, please describe your qualification and oversight processes.", N, false, 14),
    q("1.2.6", "1.2", "Scope of Work", "Describe the processes for the selection, qualification and oversight/management of 3rd party vendors.", N, false, 15),

    // -----------------------------------------------------------------------
    // 2. PROCEDURAL DOCUMENTS AND TRAINING SYSTEMS
    // -----------------------------------------------------------------------
    q("2.1.1", "2.1", "Procedural Documents", "Summarize your procedural document system — describe the levels of documents available (e.g., Policy, SOP, Work Instruction, Guideline, etc.), the general purpose of each level and review cycle for each level. Please provide an index of procedural documents.", N, true, 16),
    q("2.1.2", "2.1", "Procedural Documents", "Which department has overall responsibility for maintaining your Procedural Document System?", N, false, 17),
    q("2.1.3", "2.1", "Procedural Documents", "Who authors and approves procedural documents?", N, false, 18),
    q("2.1.4", "2.1", "Procedural Documents", "How do company personnel access procedural documents (electronic or paper system)?", N, false, 19),
    q("2.1.5", "2.1", "Procedural Documents", "For electronically distributed procedures, are appropriate controls in place for control of printed versions of the documents?", Y, false, 20),
    q("2.1.6", "2.1", "Procedural Documents", "How are deviations from procedures documented?", N, false, 21),

    q("2.2.1", "2.2", "Training Systems", "Describe your Learning Management System.", N, false, 22),
    q("2.2.2", "2.2", "Training Systems", "How are training records maintained and what are the standard contents of these records?", N, false, 23),
    q("2.2.3", "2.2", "Training Systems", "Are there formal assessments of competence before personnel can perform specific tasks? If so, please describe how competency is assessed and maintained.", Y, false, 24),
    q("2.2.4", "2.2", "Training Systems", "Does your training program include ICH GCP training?", Y, false, 25),
    q("2.2.5", "2.2", "Training Systems", "How is study-specific training documented?", N, false, 26),
    q("2.2.6", "2.2", "Training Systems", "Describe your process for the collection and maintenance of CVs and job descriptions.", N, false, 27),
    q("2.2.7", "2.2", "Training Systems", "Describe staff transition and turnover procedures.", N, false, 28),

    // -----------------------------------------------------------------------
    // 3. QUALITY ASSURANCE SYSTEM
    // -----------------------------------------------------------------------
    q("3.1.1", "3.1", "QA Organization", "Describe your Quality Management System.", N, false, 29),
    q("3.1.2", "3.1", "QA Organization", "Describe the QA Department's structure, the locations of QA personnel and the number at each location (An organization chart may be supplied to answer this request).", N, true, 30),
    q("3.1.3", "3.1", "QA Organization", "Describe how the independence of the Quality function is maintained.", N, false, 31),
    q("3.1.4", "3.1", "QA Organization", "Describe the basic responsibilities of the QA Department.", N, false, 32),
    q("3.1.5", "3.1", "QA Organization", "Describe the QA activities that will be conducted during the proposed activities.", N, false, 33),
    q("3.1.6", "3.1", "QA Organization", "Describe your QA audit program (e.g., audit identification/selection process, types of audits, etc.).", N, false, 34),
    q("3.1.7", "3.1", "QA Organization", "How many audits were performed in the last 12 months and what types?", NUM, false, 35),
    q("3.1.8", "3.1", "QA Organization", "Are audit results reported to the client?", Y, false, 36),
    q("3.1.9", "3.1", "QA Organization", "Describe your CAPA management program.", N, false, 37),
    q("3.1.10", "3.1", "QA Organization", "Is there a formal procedure for investigating serious non-compliance/serious breach, fraud and misconduct?", Y, false, 38),
    q("3.1.11", "3.1", "QA Organization", "How often is the Quality Management System (QMS) reviewed/evaluated by Executive/Senior Management?", N, false, 39),

    q("3.2.1", "3.2", "Inspections and Audits", "Within the past five years, have there been any inspections by a regulatory agency? List which agencies and dates inspected.", Y, false, 40),
    q("3.2.2", "3.2", "Inspections and Audits", "If answered yes to the above question, were any notice of observations issued (e.g., FDA Form 483, etc.) or other action letters?", Y, false, 41),
    q("3.2.3", "3.2", "Inspections and Audits", "If the findings were objectionable were corrective actions implemented?", Y, false, 42),
    q("3.2.4", "3.2", "Inspections and Audits", "How many client/sponsor audits have been performed in the last 12 months?", NUM, false, 43),

    // -----------------------------------------------------------------------
    // 4. DATA PROTECTION
    // -----------------------------------------------------------------------
    q("4.1.1", "4.1", "Data Protection / Privacy", "Describe the measures in place to preserve the Sponsor's proprietary information and study participant's confidentiality.", N, false, 44),
    q("4.1.2", "4.1", "Data Protection / Privacy", "Describe the safeguards utilized by your computerized systems to ensure data protection/integrity.", N, false, 45),
    q("4.1.3", "4.1", "Data Protection / Privacy", "Describe how physical access control is managed at your facility(ies).", N, false, 46),
    q("4.1.4", "4.1", "Data Protection / Privacy", "Does your company have a Data Protection Officer?", Y, false, 47),
    q("4.1.5", "4.1", "Data Protection / Privacy", "How does your company manage the identification, notification and management/remediation of data breach incidents?", N, false, 48),

    // 4.2 Records/Archive (note: source template skips 4.2.2)
    q("4.2.1", "4.2", "Records/Archive", "Describe the short and long-term storage facilities for study documentation.", N, false, 49),
    q("4.2.3", "4.2", "Records/Archive", "Describe the access controls employed for your records storage/archive area.", N, false, 50),
    q("4.2.4", "4.2", "Records/Archive", "Describe the environmental protection measures implemented in archive areas.", N, false, 51),
    q("4.2.5", "4.2", "Records/Archive", "Describe your record retention policy.", N, false, 52),
    q("4.2.6", "4.2", "Records/Archive", "Describe the processes in place for transfer of study documentation/data to the Sponsor.", N, false, 53),

    // -----------------------------------------------------------------------
    // 5. COMPUTER SYSTEMS AND BUSINESS CONTINUITY
    // -----------------------------------------------------------------------
    q("5.1.1", "5.1", "Computer Systems", "Please list the computer systems applicable to the proposed activities.", L, false, 54),
    q("5.1.2", "5.1", "Computer Systems", "Have these computer systems been assessed for GxP and 21 CFR Part 11 compliance?", Y, true, 55),
    q("5.1.3", "5.1", "Computer Systems", "Describe your System Development Life Cycle process(es).", N, false, 56),
    q("5.1.4", "5.1", "Computer Systems", "Are your company's computer systems and data located/stored on your premises or are external data centers used?", N, false, 57),
    q("5.1.5", "5.1", "Computer Systems", "Please summarize your basic computer security systems, such as access control, anti-virus protection and back-up arrangements.", N, false, 58),

    q("5.2.1", "5.2", "Business Continuity / Disaster Recovery", "Does your company have a business continuity and/or disaster recovery plan? If yes, when was it last updated, and how often is it tested?", Y, false, 59),
    q("5.2.2", "5.2", "Business Continuity / Disaster Recovery", "Please provide any specific business continuity safeguards relating to the proposed activities (e.g., back-up generators, fire prevention mechanisms, alternative sample storage options, etc.).", N, false, 60),

    // Section 5.3 "Other" is intentionally not seeded — it is generated per
    // QuestionnaireInstance from VendorServiceMappingObject by
    // lib/questionnaires.ts → generateAddenda().
  ],
};

function q(
  questionNumber: string,
  sectionCode: string,
  sectionTitle: string,
  prompt: string,
  answerType: QuestionAnswerType,
  evidenceExpected: boolean,
  ordinal: number
) {
  return {
    questionNumber,
    sectionCode,
    sectionTitle,
    prompt,
    answerType,
    evidenceExpected,
    ordinal,
  };
}

// -----------------------------------------------------------------------------
// Idempotent seed runner. Safe to invoke from prisma db seed multiple times —
// publishes a new version only if the seed's versionNumber doesn't yet exist.
// -----------------------------------------------------------------------------
export async function seedStandardGcpVendorTemplate(prisma: PrismaClient) {
  const seed = standardGcpVendorTemplate;

  const template = await prisma.questionnaireTemplate.upsert({
    where: { slug: seed.slug },
    update: { name: seed.name, description: seed.description, isDefault: seed.isDefault },
    create: {
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      isDefault: seed.isDefault,
    },
  });

  const existingVersion = await prisma.questionnaireTemplateVersion.findUnique({
    where: {
      templateId_versionNumber: {
        templateId: template.id,
        versionNumber: seed.versionNumber,
      },
    },
  });

  if (existingVersion) {
    console.log(
      `Template "${seed.slug}" v${seed.versionNumber} already exists — skipping.`
    );
    return existingVersion;
  }

  const version = await prisma.questionnaireTemplateVersion.create({
    data: {
      templateId: template.id,
      versionNumber: seed.versionNumber,
      notes: seed.notes,
    },
  });

  await prisma.questionnaireQuestion.createMany({
    data: seed.questions.map((q) => ({
      origin: "TEMPLATE" as const,
      templateVersionId: version.id,
      questionNumber: q.questionNumber,
      sectionCode: q.sectionCode,
      sectionTitle: q.sectionTitle,
      prompt: q.prompt,
      answerType: q.answerType,
      evidenceExpected: q.evidenceExpected,
      ordinal: q.ordinal,
    })),
  });

  console.log(
    `Seeded template "${seed.slug}" v${seed.versionNumber} with ${seed.questions.length} questions.`
  );
  return version;
}
