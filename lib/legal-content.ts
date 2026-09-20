/**
 * The text of the public legal pages, held as data rather than JSX so the two pages share one
 * renderer and one shape.
 *
 * Every company-specific word is a parameter. The platform is multi-tenant, so no operator name,
 * contact or jurisdiction may be written into this file -- each one is resolved from the tenant's
 * own settings at render time, and a tenant that has not set one gets wording that still reads
 * correctly without it.
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

export function privacyPolicy(tenant: LegalTenant): LegalDocument {
  const operator = operatorOf(tenant);
  const { appName } = tenant;

  return {
    title: 'Privacy Policy',
    summary: `How ${appName} handles the information you share with us.`,
    lastUpdated: LAST_UPDATED,
    intro: [
      `This policy explains what information ${appName} collects, why we collect it, who we share it with, and the choices you have. It applies to the ${appName} website and to everything you do once you are signed in.`,
      `${appName} is operated by ${operator}, which is the party responsible for the information described here.`,
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
            'Details you provide when you contact support or apply for a programme.',
          ],
          'You do not have to fill in optional profile fields, and you can edit or clear them at any time from your account settings.',
        ],
      },
      {
        heading: 'Information we collect as you learn',
        body: [
          'The platform records your progress so it can show you where you are, and so your instructors can support you. This includes:',
          [
            'Which courses, learning paths, virtual experiences and assignments you have started or finished.',
            'Attempts, scores, points and completion dates.',
            'Assignment submissions and the files attached to them, together with any grade or feedback an instructor records.',
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
          'Where the platform charges for access, payments are handled by a third-party payment provider. Your card details are entered on the provider systems and are never stored by us. We keep a record of the plan you bought, the amount, the date and the reference the provider returns, so we can give you the access you paid for and answer billing questions.',
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
          'We do not sell your personal information, and we do not use your learning activity to build advertising profiles.',
        ],
      },
      {
        heading: 'Cookies and similar technologies',
        body: [
          'We use cookies and browser storage for a small number of purposes:',
          [
            'Signing you in and keeping you signed in for the length of your session.',
            'Remembering preferences such as your theme or the tab you last opened.',
            'Measuring how the platform is used, where analytics is enabled by your organisation.',
          ],
          'The first two are necessary for the platform to work. If you block them in your browser, you will not be able to stay signed in. You can clear cookies and browser storage at any time through your browser settings.',
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
          'Parts of the platform use third-party AI models, for example to help an instructor draft course material, or to answer a learner question about the lesson in front of them.',
          'When you use one of these features, the text needed to answer you is sent to the model provider. For the lesson assistant that is the content of the lesson and the question you asked. Those conversations are not kept after your session ends, and they are not used to grade you.',
          'We do not send model providers your password, your payment details, or the personal details of other learners.',
        ],
      },
      {
        heading: 'Who we share information with',
        body: [
          'We share information only where it is needed to run the platform:',
          [
            'With the organisation that gave you access, including its instructors and administrators.',
            'With service providers who host the database, store files and images, send email, process payments, provide AI features and monitor errors on our behalf. They may only use the information to provide that service to us.',
            'Where we are required to by law, or where it is necessary to protect the rights, safety or property of learners, the public or us.',
            'With a successor organisation if the platform or the business behind it is transferred, in which case this policy continues to apply until you are told otherwise.',
          ],
        ],
      },
      {
        heading: 'How long we keep information',
        body: [
          'We keep your account and learning records for as long as your account is active, because they are the record of what you have completed and what you have been awarded. Records needed for tax, accounting or legal reasons are kept for as long as the law requires.',
          'If your account is closed, we delete or anonymise your personal details. Certificates that have already been issued and made publicly verifiable may remain verifiable, since their purpose is to prove that an award was made.',
        ],
      },
      {
        heading: 'Your choices and your rights',
        body: [
          'Depending on where you live, you may have the right to ask for a copy of the information we hold about you, to have it corrected, to have it deleted, to object to how we use it, or to withdraw a consent you gave.',
          `You can edit most of your details yourself from your account settings. ${contactLine(tenant, 'make any other request')}`,
          'We will respond within the time the applicable law allows. We may need to confirm your identity first.',
        ],
      },
      {
        heading: 'Security',
        body: [
          'We protect information with encryption in transit, access controls that limit each account to the records it is entitled to, and separate storage for private files such as graded work and model answers, which are served through short-lived links rather than public addresses.',
          'No system is completely secure. Please use a strong and unique password, and tell us at once if you believe someone else has used your account.',
        ],
      },
      {
        heading: 'Young learners',
        body: [
          'The platform is built for adult and professional learners. Where an organisation enrols learners below the age of majority in their country, that organisation is responsible for obtaining the consent its local law requires.',
        ],
      },
      {
        heading: 'Where information is held',
        body: [
          'Our hosting, storage and email providers operate internationally, so your information may be stored or processed in a country other than your own. Where that happens we rely on providers that offer protections recognised for international transfers.',
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
          contactLine(tenant, 'ask a question about this policy or about your information'),
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
        heading: 'Access to courses and programmes',
        body: [
          'What you can open depends on the plan you hold, the cohort you belong to, and what your organisation has published to you. Access may be granted for a period, for a single programme, or for as long as your subscription runs.',
          'Course content is revised over time. We may correct, update, reorganise or retire material, and we may change or remove a course where we need to.',
        ],
      },
      {
        heading: 'Payments and renewals',
        body: [
          'Where access is paid, the price, the currency and the length of access are shown before you pay. Payment is taken through a third-party payment provider and is subject to that provider own terms.',
          'Access begins once payment is confirmed and ends when the period you paid for ends. Where a subscription renews automatically, this is stated at the point of purchase, and you can cancel future renewals from your account before the next charge.',
          'Taxes, and any charges applied by your bank or card issuer, are your responsibility.',
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
            'Attempt to bypass access controls, probe the platform for vulnerabilities, scrape it, or interfere with its operation.',
            'Upload anything unlawful or malicious, or anything that infringes someone else rights.',
            'Harass, abuse or impersonate anyone, including instructors and other learners.',
          ],
        ],
      },
      {
        heading: 'Work you submit',
        body: [
          'You keep ownership of the assignments, projects, files and comments you submit. You grant us the permission we need to store that work, show it to your instructors and administrators, mark it, and display it back to you.',
          'Do not upload confidential information belonging to your employer or to a third party unless you are permitted to.',
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
        ],
      },
      {
        heading: 'Third-party services and links',
        body: [
          'The platform embeds and links to material provided by others, including video, documents, datasets and payment services. We do not control that material and are not responsible for it. Your use of a third-party service is governed by that service own terms.',
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
        ],
      },
      {
        heading: 'No guarantee of outcomes',
        body: [
          'The platform provides education and practice. We do not promise a particular exam result, qualification, job, promotion or level of income as a result of using it.',
        ],
      },
      {
        heading: 'Liability',
        body: [
          'The platform is provided as it is. To the fullest extent the law allows, we exclude implied warranties, and we are not liable for indirect or consequential loss, for lost profits, or for loss of data.',
          'Nothing in these terms limits liability that cannot be limited by law, including liability for death or personal injury caused by negligence, or for fraud. Where liability can be limited, our total liability is limited to the amount you paid for access in the twelve months before the claim arose.',
        ],
      },
      {
        heading: 'Governing law',
        body: [
          `These terms are governed by the law of the country in which ${operator} is established, and the courts of that country have jurisdiction. This does not remove any protection given to you by the mandatory law of the country you live in.`,
        ],
      },
      {
        heading: 'Changes to these terms',
        body: [
          'We may revise these terms as the platform changes. The date at the top shows when they were last revised. Where a change materially affects your rights, we will tell you before it takes effect. Continuing to use the platform after that means you accept the revised terms.',
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
