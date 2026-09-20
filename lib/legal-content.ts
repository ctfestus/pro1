/**
 * The text of the public legal pages, held as data rather than JSX so the two pages share one
 * renderer and one shape.
 *
 * Every company-specific word is a parameter. The platform is multi-tenant, so no operator name,
 * contact or jurisdiction may be written into this file -- each one is resolved from the tenant's
 * own settings at render time, and a tenant that has not set one gets wording that still reads
 * correctly without it.
 *
 * Coverage follows what a mature learning platform's terms and policy address (account, plans and
 * renewal, trials and preview features, organisation-administered seats, acceptable use, user
 * content, IP, feedback, copyright complaints, indemnity, disclaimers, liability, dispute
 * resolution and the usual boilerplate; and for privacy: categories collected, legal grounds,
 * cookies, analytics, AI, marketing opt-out, profiling, sharing, transfers, retention, rights,
 * security and children). The wording is this platform's own and describes what this platform
 * actually does -- it is not lifted from another service, whose text would describe their
 * business rather than ours.
 *
 * These documents are a starting template. An operator is expected to have them reviewed against
 * the law of the place it actually trades in before relying on them.
 */

/** A paragraph, or a bullet list. */
export type LegalBlock = string | string[];

export interface LegalSection {
  heading: string;
  body: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  /** Plain-language line under the title. */
  summary: string;
  lastUpdated: string;
  intro: string[];
  sections: LegalSection[];
}

export interface LegalTenant {
  appName: string;
  /** The legal entity behind the platform, when the tenant has set one. */
  orgName?: string;
  supportEmail?: string;
}

/** The date both documents carry until their wording next changes. */
const LAST_UPDATED = '20 September 2026';

/** The operator to name in the text. Falls back to the platform name when no entity is set. */
function operatorOf(tenant: LegalTenant): string {
  return tenant.orgName?.trim() || tenant.appName;
}

/** How to tell a reader to reach the operator, with or without a configured support address. */
function contactLine(tenant: LegalTenant, purpose: string): string {
  return tenant.supportEmail
    ? `To ${purpose}, write to ${tenant.supportEmail}.`
    : `To ${purpose}, contact the administrator who gave you access to ${tenant.appName}.`;
}

/** Where to send something, as a sentence fragment that works with or without a support address. */
function contactPhrase(tenant: LegalTenant): string {
  return tenant.supportEmail
    ? `at ${tenant.supportEmail}`
    : 'through the administrator who gave you access';
}

export function privacyPolicy(tenant: LegalTenant): LegalDocument {
  const operator = operatorOf(tenant);
  const { appName } = tenant;

  return {
    title: 'Privacy Policy',
    summary: `How ${appName} handles the information you share with us.`,
    lastUpdated: LAST_UPDATED,
    intro: [
      `This policy explains what information ${appName} collects, why we collect it, who we share it with, how long we keep it, and the choices you have. It applies to the ${appName} website and to everything you do once you are signed in.`,
      `${appName} is operated by ${operator}. For the information described here, ${operator} is the data controller, which means it is the party that decides why and how the information is used and is answerable for it.`,
      'Where an organisation such as an employer or a training provider enrolled you, that organisation decides what you are enrolled on and who supervises you, and it is responsible for its own use of your records.',
    ],
    sections: [
      {
        heading: 'Information you give us',
        body: [
          'You give us information directly when you create an account or use the platform:',
          [
            'Account details such as your name, email address and password.',
            'Profile details you choose to add, such as a photo, a job title, a location or a short biography.',
            'Anything you write into the platform, including answers, project work, uploaded files, comments and messages to instructors.',
            'Details you provide when you contact support, apply for a programme, or confirm a payment.',
          ],
          'You do not have to fill in optional profile fields, and you can edit or clear them at any time from your account settings. Some fields are required to create an account or to take payment, and the platform will tell you which.',
        ],
      },
      {
        heading: 'Information we collect as you learn',
        body: [
          'The platform records your progress so it can show you where you are, and so your instructors can support you. This includes:',
          [
            'Which courses, learning paths, virtual experiences, assignments and certifications you have started or finished.',
            'Attempts, answers, scores, points, badges and completion dates.',
            'Assignment submissions and the files attached to them, together with any grade or feedback an instructor records.',
            'Attendance where a programme runs live sessions.',
            'Certificates and credentials issued to you.',
          ],
          'Instructors and administrators for your organisation can see this activity for the learners they are responsible for. Other learners cannot, apart from a leaderboard position where your organisation has enabled one.',
        ],
      },
      {
        heading: 'Information collected automatically',
        body: [
          'When you visit the platform we receive some technical information, such as your IP address, browser type, device type, the pages you open and the time you opened them. We use this to keep the service running, to keep accounts secure and to diagnose faults.',
          'We also use error monitoring, which records the technical details of a crash or failure so we can fix it. We take reasonable steps to strip authentication tokens and similar secrets from those reports before they are sent.',
        ],
      },
      {
        heading: 'Payments',
        body: [
          'Where the platform charges for access, payments are handled by a third-party payment provider. Your card details are entered on the provider\'s systems and are never stored by us. We keep a record of the plan you bought, the amount, the date and the reference the provider returns, so we can give you the access you paid for and answer billing questions.',
          'Where your organisation pays on your behalf, or where you upload proof of a bank transfer for an administrator to approve, we keep that record for the same reasons.',
        ],
      },
      {
        heading: 'How we use your information',
        body: [
          'We use the information described above to:',
          [
            'Create and secure your account and sign you in.',
            'Give you access to the courses and programmes you are entitled to.',
            'Record your progress, mark your work and issue certificates.',
            'Let your instructors and administrators support you and report on their cohorts.',
            'Send you service messages such as confirmations, reminders, grade notifications and password resets.',
            'Take payment and manage subscriptions.',
            'Keep the platform reliable, investigate faults, prevent abuse and enforce our terms.',
            'Understand how the platform is used in aggregate so we can improve it.',
          ],
          'We do not sell your personal information, we do not share it for cross-context behavioural advertising, and we do not use your learning activity to build advertising profiles.',
        ],
      },
      {
        heading: 'Our legal grounds for using your information',
        body: [
          'Where data protection law requires us to name a legal ground, these are the ones we rely on:',
          [
            'Performance of a contract, for running your account, giving you the access you or your organisation paid for, marking your work and issuing your certificates.',
            'Legitimate interests, for keeping the platform secure and reliable, preventing abuse, diagnosing faults, and understanding in aggregate how the platform is used so we can improve it. We weigh those interests against your rights and use the least intrusive option that works.',
            'Consent, for optional things such as promotional messages and, where your organisation enables it, analytics. You can withdraw consent at any time, and withdrawing it does not affect what we did before you withdrew it.',
            'Legal obligation, for keeping financial records and for responding to lawful requests.',
          ],
        ],
      },
      {
        heading: 'Cookies and similar technologies',
        body: [
          'We use cookies and browser storage for a small number of purposes:',
          [
            'Signing you in and keeping you signed in for the length of your session.',
            'Remembering preferences such as your theme, or the tab you last opened.',
            'Measuring how the platform is used, where analytics is enabled by your organisation.',
          ],
          'The first two are necessary for the platform to work. If you block them in your browser, you will not be able to stay signed in. You can clear cookies and browser storage at any time through your browser settings.',
          'We do not use advertising cookies, and we do not allow advertising networks to track you across other websites. Any promotional cards you see on the platform are placed by your own organisation and are not served by an ad network.',
        ],
      },
      {
        heading: 'Analytics',
        body: [
          'Your organisation may enable a third-party analytics service to measure how the platform is used. Where it is enabled, that service receives page addresses, an approximate location derived from your IP address, and general device information. We remove authentication details from page addresses before they are sent.',
          'Analytics is configured by the platform administrator and can be switched off from the administration settings, which stops the service loading for everyone.',
        ],
      },
      {
        heading: 'AI features',
        body: [
          'Parts of the platform use third-party AI models, for example to help an instructor draft course material, or to answer a learner\'s question about the lesson in front of them.',
          'When you use one of these features, the text needed to answer you is sent to the model provider. For the lesson assistant that is the content of the lesson and the question you asked. Those conversations are not kept after your session ends, and they are not used to grade you.',
          'What a provider may do with that text depends on the plan the feature runs on. On a paid plan, providers do not use it to train their models. Where a feature runs on a provider\'s free tier, that provider may use the content to improve its own services. For that reason, please do not type personal or confidential information into an AI feature.',
          'We never send model providers your password, your payment details, or the personal details of other learners.',
        ],
      },
      {
        heading: 'Messages we send you',
        body: [
          'There are two kinds of message, and they work differently:',
          [
            'Service messages are part of your account: confirmations, password resets, enrolment and cohort notices, deadline and session reminders, grades, receipts and subscription notices. You cannot opt out of these while your account is open, because they are how the platform tells you what is happening to your own learning.',
            'Promotional messages tell you about new programmes and offers. Every one of them carries an unsubscribe link, and unsubscribing stops them without affecting your account or your service messages.',
          ],
          `You can also ask us to stop sending promotional messages ${contactPhrase(tenant)}.`,
        ],
      },
      {
        heading: 'Personalisation and automated decisions',
        body: [
          'We use your progress to personalise what the platform shows you, such as which course to suggest next and which reminder is worth sending. Instructors may also see a flag where a learner appears to be falling behind, so that a person can decide whether to reach out.',
          'We do not make decisions that produce a legal or similarly significant effect on you by automated means alone. Grades awarded by an instructor are decided by that instructor, and an automatically scored assessment can be reviewed by one on request.',
        ],
      },
      {
        heading: 'Who we share information with',
        body: [
          'We share information only where it is needed to run the platform:',
          [
            'With the organisation that gave you access, including its instructors and administrators.',
            'With service providers who host the database, store files and images, send email, process payments, provide AI features and monitor errors on our behalf. They act on our instructions and may only use the information to provide that service to us.',
            'Where we are required to by law, or where it is necessary to protect the rights, safety or property of learners, the public or us.',
            'With a successor organisation if the platform or the business behind it is transferred, in which case this policy continues to apply until you are told otherwise.',
          ],
          'We do not share your information with anyone else for their own purposes.',
        ],
      },
      {
        heading: 'Where information is held',
        body: [
          'Our hosting, storage, email and AI providers operate internationally, so your information may be stored or processed in a country other than your own, including countries whose data protection law differs from yours.',
          'Where information leaves a region that restricts transfers, we rely on the protections recognised for that purpose, such as standard contractual clauses in our agreements with those providers, or a finding that the destination country offers adequate protection.',
        ],
      },
      {
        heading: 'How long we keep information',
        body: [
          'We keep information only as long as there is a reason to:',
          [
            'Account and learning records, for as long as your account is active, because they are the record of what you have completed and what you have been awarded.',
            'Payment and invoice records, for the period tax and accounting law requires, which is commonly up to seven years.',
            'Technical logs and error reports, for a short period while they are useful for diagnosing and preventing faults.',
            'Lesson assistant conversations, only for the length of your session.',
          ],
          'If your account is closed, we delete or anonymise your personal details. Certificates that have already been issued and made publicly verifiable may remain verifiable, since their purpose is to prove that an award was made. Where a claim or legal obligation requires it, we keep what is needed for as long as that lasts.',
        ],
      },
      {
        heading: 'Your choices and your rights',
        body: [
          'Depending on where you live, you may have the right to:',
          [
            'Ask for a copy of the information we hold about you.',
            'Have inaccurate information corrected.',
            'Have information deleted where there is no longer a reason to keep it.',
            'Receive the information you gave us in a portable form, or have it sent to another provider where that is technically possible.',
            'Object to, or ask us to restrict, uses that rely on our legitimate interests.',
            'Withdraw a consent you gave, including for promotional messages.',
          ],
          `You can edit most of your details yourself from your account settings. ${contactLine(tenant, 'make any other request')}`,
          'We will respond within the time the applicable law allows, and we may need to confirm your identity first. If you are not satisfied with our answer, you may complain to the data protection authority in your country.',
        ],
      },
      {
        heading: 'If you live in California',
        body: [
          'We do not sell personal information, and we do not share it for cross-context behavioural advertising. We have not done so in the last twelve months, which is why the platform carries no do-not-sell link.',
          'You may still ask what we have collected about you, ask for it to be corrected or deleted, and receive it in a portable form, using the rights described above. We will not treat you differently for exercising them.',
        ],
      },
      {
        heading: 'Security',
        body: [
          'We protect information with encryption in transit, access controls that limit each account to the records it is entitled to, and separate storage for private files such as graded work and model answers, which are served through short-lived links rather than public addresses.',
          'No system is completely secure. Please use a strong and unique password, and tell us at once if you believe someone else has used your account. If a breach affects your information and the law requires it, we will notify you and the relevant authority without undue delay.',
        ],
      },
      {
        heading: 'Children',
        body: [
          'The platform is built for adult and professional learners, and is not directed at children under 13. We do not knowingly collect information from them, and we will delete it if we find that we have.',
          'Where an organisation enrols learners below the age of majority in their country, that organisation is responsible for obtaining the consent its local law requires.',
        ],
      },
      {
        heading: 'Changes to this policy',
        body: [
          'We may update this policy as the platform changes. The date at the top shows when it was last revised. If a change materially affects how we use your information, we will tell you through the platform or by email before it takes effect.',
        ],
      },
      {
        heading: 'Contact us',
        body: [
          contactLine(tenant, 'ask a question about this policy, exercise a right, or raise a concern'),
        ],
      },
    ],
  };
}

export function termsOfUse(tenant: LegalTenant): LegalDocument {
  const operator = operatorOf(tenant);
  const { appName } = tenant;

  return {
    title: 'Terms of Use',
    summary: `The agreement between you and ${operator} for your use of ${appName}.`,
    lastUpdated: LAST_UPDATED,
    intro: [
      `These terms govern your use of ${appName}, which is operated by ${operator}. By creating an account or using the platform, you agree to them. If you do not agree, please do not use the platform.`,
      'Our Privacy Policy explains how we handle your information and forms part of this agreement.',
    ],
    sections: [
      {
        heading: 'Who can use the platform',
        body: [
          'You may use the platform if you can form a binding contract where you live, or if an organisation has enrolled you and is responsible for you. If you are using the platform on behalf of an organisation, you confirm that you are authorised to accept these terms for it.',
        ],
      },
      {
        heading: 'Your account',
        body: [
          'You are responsible for the accuracy of the details on your account, for keeping your password confidential, and for everything done through your account.',
          'Accounts are personal. Do not share your login, and do not let anyone else complete assessments, assignments or certifications in your name. Tell us immediately if you think your account has been compromised.',
        ],
      },
      {
        heading: 'Accounts provided by an organisation',
        body: [
          'Where an employer, school or training provider bought your access or enrolled you in a cohort, that organisation administers your account. It decides what you are enrolled on, can see your progress, grades and submitted work, and can withdraw your access when your place with it ends.',
          'Your relationship with that organisation is between you and it. If your access is withdrawn, ask the organisation, not us.',
        ],
      },
      {
        heading: 'Access to courses and programmes',
        body: [
          'What you can open depends on the plan you hold, the cohort you belong to, and what your organisation has published to you. Access may be granted for a period, for a single programme, or for as long as your subscription runs.',
          'Course content is revised over time. We may correct, update, reorganise or retire material, and we may change or remove a course where we need to.',
        ],
      },
      {
        heading: 'Free access, trials and preview features',
        body: [
          'Some material is free, and a plan may include a trial period. Free and trial access can be changed, limited or withdrawn, and may carry limits on how much of a feature you can use.',
          'Features marked as new, preview or beta are provided as they are while we finish them. They may behave unpredictably, change without notice, or be withdrawn, and we do not promise they will become part of a paid plan.',
        ],
      },
      {
        heading: 'Payments and renewals',
        body: [
          'Where access is paid, the price, the currency and the length of access are shown before you pay. Payment is taken through a third-party payment provider and is subject to that provider\'s own terms.',
          'Access begins once payment is confirmed and ends when the period you paid for ends. Where a subscription renews automatically, this is stated at the point of purchase, and you can cancel future renewals from your account before the next charge. Cancelling stops the next charge; it does not shorten the period you have already paid for.',
          'Taxes, and any charges applied by your bank or card issuer, are your responsibility. If a payment fails or is reversed, we may suspend access until it is settled.',
        ],
      },
      {
        heading: 'Refunds',
        body: [
          `Refund requests are handled by the organisation that sold you the access, and any statutory right to cancel that applies where you live continues to apply. ${contactLine(tenant, 'request a refund')}`,
        ],
      },
      {
        heading: 'Acceptable use',
        body: [
          'When you use the platform, you agree not to:',
          [
            'Copy, download in bulk, republish, resell or share course material, assessments or datasets outside the platform.',
            'Share answers, model solutions or assessment content with other learners or in public.',
            'Submit work that is not your own where the task asks for your own work, or present generated output as your own where a task forbids it.',
            'Use the platform, or anything you take from it, to build or train a competing product or service.',
            'Reverse engineer, decompile or attempt to derive the source of the platform, except where the law gives you that right.',
            'Attempt to bypass access controls, probe the platform for vulnerabilities, scrape it, use automated tools against it, or interfere with its operation.',
            'Upload anything unlawful or malicious, or anything that infringes someone else\'s rights.',
            'Harass, abuse or impersonate anyone, including instructors and other learners.',
          ],
        ],
      },
      {
        heading: 'Work you submit',
        body: [
          'You keep ownership of the assignments, projects, files and comments you submit. You grant us the permission we need to store that work, show it to your instructors and administrators, mark it, and display it back to you. That permission lasts as long as we hold the work and no longer.',
          'You confirm that the work is yours to submit and that it does not infringe anyone else\'s rights. Do not upload confidential information belonging to your employer or to a third party unless you are permitted to.',
        ],
      },
      {
        heading: 'Our content',
        body: [
          'Courses, lessons, virtual experiences, datasets, assessments, designs and software on the platform belong to the operator or to its licensors, and are protected by intellectual property law.',
          'You are given a personal, non-transferable licence to use them for your own learning while your access lasts. No other rights are granted.',
        ],
      },
      {
        heading: 'Feedback',
        body: [
          'If you send us suggestions about the platform, we may use them without restriction and without owing you payment or credit. We are not asking you to send confidential ideas, and you should not.',
        ],
      },
      {
        heading: 'Certificates and credentials',
        body: [
          'A certificate records that you completed the stated requirements on the stated date. It is not a licence, a degree, or an accreditation unless the certificate itself says so.',
          'We may verify a certificate, or revoke one that was obtained through inaccurate information or through a breach of these terms.',
        ],
      },
      {
        heading: 'AI features',
        body: [
          'Some features use AI models to generate or explain content. AI output can be wrong, incomplete or out of date. Check anything you intend to rely on, and treat AI explanations as study support rather than as authoritative instruction or professional advice.',
          'Do not use AI output from the platform to make decisions with a significant effect on a person, such as hiring, credit, housing, insurance or medical decisions, and do not feed it sensitive personal information about other people.',
        ],
      },
      {
        heading: 'Reporting content that infringes copyright',
        body: [
          `If you believe material on the platform infringes your copyright, tell us ${contactPhrase(tenant)} and include:`,
          [
            'What the material is and where on the platform you found it.',
            'What work you say it infringes, and proof that you own that work or act for the owner.',
            'Your name and contact details.',
            'A statement that you believe in good faith that the use is not authorised, and that the information you have given is accurate.',
          ],
          'We will review the report and remove or restrict material where the claim is made out. We may pass the report to whoever uploaded the material, and we may close the account of anyone who repeatedly infringes.',
        ],
      },
      {
        heading: 'Third-party services and links',
        body: [
          'The platform embeds and links to material provided by others, including video, documents, datasets and payment services. We do not control that material and are not responsible for it. Your use of a third-party service is governed by that service\'s own terms.',
        ],
      },
      {
        heading: 'Availability',
        body: [
          'We work to keep the platform available, but we do not guarantee uninterrupted access. Maintenance, faults, and problems at our providers can interrupt the service. We may add, change or withdraw features.',
        ],
      },
      {
        heading: 'Suspension and termination',
        body: [
          'You may stop using the platform at any time, and ask for your account to be closed.',
          'We may suspend or close an account that breaches these terms, that is used to compromise assessments, or where we are required to by law. Where access was paid for and we close an account without cause, we will refund the unused part of the period you paid for.',
          'When an account closes, access to the material ends. Download anything you want to keep first, subject to the limits in Acceptable use. We handle what remains as set out in the Privacy Policy.',
        ],
      },
      {
        heading: 'No guarantee of outcomes',
        body: [
          'The platform provides education and practice. We do not promise a particular exam result, qualification, job, promotion or level of income as a result of using it.',
        ],
      },
      {
        heading: 'Your responsibility to us',
        body: [
          'If someone brings a claim against us because of how you used the platform, because of something you uploaded, or because you broke these terms or the law, you agree to cover the reasonable costs and damages that result. We will tell you about any such claim and give you the chance to take part in defending it.',
          'This does not apply to the extent the claim is caused by something we did wrong.',
        ],
      },
      {
        heading: 'Disclaimers',
        body: [
          'The platform is provided as it is and as available. To the fullest extent the law allows, we exclude implied warranties, including warranties of merchantability, fitness for a particular purpose, accuracy and non-infringement.',
          'We do not warrant that the platform will be uninterrupted or error free, that defects will be corrected, or that course material is free of mistakes. Nothing here excludes a warranty that cannot be excluded where you live.',
        ],
      },
      {
        heading: 'Limitation of liability',
        body: [
          'To the fullest extent the law allows, we are not liable for indirect or consequential loss, for lost profits, for lost opportunity, or for loss or corruption of data.',
          'Where liability can be limited, our total liability for all claims is limited to the amount you paid for access in the twelve months before the claim arose, or, if you paid nothing, to a nominal amount.',
          'Nothing in these terms limits liability that cannot be limited by law, including liability for death or personal injury caused by negligence, or for fraud.',
        ],
      },
      {
        heading: 'Resolving a dispute',
        body: [
          `If something goes wrong, contact us ${contactPhrase(tenant)} first and describe the problem. Most disputes are settled quickly this way, and we ask you to give us 30 days to put it right before starting proceedings.`,
          'Neither of us is prevented from asking a court for urgent relief, such as an order to stop misuse of intellectual property.',
        ],
      },
      {
        heading: 'Governing law',
        body: [
          `These terms are governed by the law of the country in which ${operator} is established, and the courts of that country have jurisdiction. This does not remove any protection given to you by the mandatory law of the country you live in, or your right to bring a claim there where the law allows it.`,
        ],
      },
      {
        heading: 'Changes to these terms',
        body: [
          'We may revise these terms as the platform changes. The date at the top shows when they were last revised. Where a change materially affects your rights, we will tell you before it takes effect. Continuing to use the platform after that means you accept the revised terms.',
        ],
      },
      {
        heading: 'General',
        body: [
          'A few points that apply to the agreement as a whole:',
          [
            'These terms, together with the Privacy Policy and anything shown to you at the point of purchase, are the entire agreement between us about the platform.',
            'If a court finds part of these terms unenforceable, the rest continues to apply.',
            'If we do not enforce a right straight away, we do not give it up.',
            'You may not transfer your account or your rights under these terms. We may transfer ours to a successor organisation, and will tell you if we do.',
            'We may give you notice through the platform or by email to the address on your account, and you agree to receive notices that way.',
            'The sections on our content, work you submit, feedback, your responsibility to us, disclaimers, limitation of liability, dispute resolution and governing law continue to apply after your account closes.',
          ],
        ],
      },
      {
        heading: 'Contact',
        body: [
          contactLine(tenant, 'ask a question about these terms'),
        ],
      },
    ],
  };
}
