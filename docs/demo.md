# Demo transcript

A **real run** (2026-11-15) of the built server (`dist/server.js`) driven over stdio by a real MCP client (`scripts/demo.ts`, using `@modelcontextprotocol/sdk`). It is **not** a Claude chat: no LLM was in the loop; the calls are the search -> get -> compare chain an agent would make, with each argument taken from the previous result. Reproduce: `npm run build && npx tsx scripts/demo.ts`. `get_course` shows the Agent enrichment (35 s); `compare_courses` ran Fetch-only (default).

```
TOOLS: search_courses, get_course, compare_courses 

>>> search_courses {"query":"machine learning","institute":"IIT Madras","limit":3,"refresh":true}
<<< (6.8s)
[
  {
    "course_id": "106106139",
    "title": "NOC: Introduction to Machine Learning",
    "discipline": null,
    "institute": "IIT Madras",
    "instructors": [
      "Prof. Balaraman Ravindran"
    ],
    "url": "https://nptel.ac.in/courses/106106139"
  },
  {
    "course_id": "106106236",
    "title": "NOC: Introduction to Machine Learning (Tamil)",
    "discipline": null,
    "institute": "IIT Madras",
    "instructors": [
      "Prof. Arun Rajkumar"
    ],
    "url": "https://nptel.ac.in/courses/106106236"
  },
  {
    "course_id": "106106213",
    "title": "NOC: Practical Machine Learning with Tensorflow",
    "discipline": null,
    "institute": "IIT Madras & Google",
    "instructors": [
      "Prof. Ashish Tendulkar",
      "Prof. Balaraman Ravindran"
    ],
    "url": "https://nptel.ac.in/courses/106106213"
  }
]

>>> get_course {"course_id":"106106139","refresh":true}
<<< (35.1s)
{
  "course_id": "106106139",
  "title": "NOC: Introduction to Machine Learning",
  "institute": "IIT Madras",
  "discipline": null,
  "instructors": [
    "Prof. Balaraman Ravindran"
  ],
  "syllabus": "With the increased availability of data from varied sources there has been increasing attention paid to the various data driven disciplines such as analytics and machine learning. In this course we intend to introduce some of the basic concepts of machine learning from a mathematically well motivated perspective. We will cover the different learning paradigms and some of the more popular algorithms and architectures used in each of these paradigms.",
  "duration": "Jul-Oct 2026",
  "schedule": "Enrollment: 2026-05-22 to 2026-07-27\nExam Registration: 2026-06-20 to 2026-08-14\nExam Date: 2026-10-18",
  "url": "https://nptel.ac.in/courses/106106139",
  "available_sections": [
    "about",
    "course",
    "downloads",
    "TA list",
    "statistics",
    "toppers list",
    "certificate type",
    "Syllabus"
  ],
  "fields_unavailable": [
    "discipline"
  ],
  "enrichment": "ok",
  "enrichment_error": null
}

>>> compare_courses {"course_ids":["106106139","106106236","106106213"],"refresh":true}
<<< (8.1s)
{
  "courses": [
    {
      "course_id": "106106139",
      "title": "NOC: Introduction to Machine Learning",
      "institute": "IIT Madras",
      "discipline": null,
      "instructors": [
        "Prof. Balaraman Ravindran"
      ],
      "syllabus": null,
      "duration": null,
      "schedule": null,
      "url": "https://nptel.ac.in/courses/106106139",
      "available_sections": [
        "about",
        "course",
        "downloads",
        "TA list",
        "statistics",
        "toppers list",
        "certificate type",
        "Syllabus"
      ],
      "fields_unavailable": [
        "discipline",
        "syllabus",
        "duration",
        "schedule"
      ],
      "enrichment": "skipped",
      "enrichment_error": null
    },
    {
      "course_id": "106106236",
      "title": "NOC: Introduction to Machine Learning (Tamil)",
      "institute": "IIT Madras",
      "discipline": null,
      "instructors": [
        "Prof. Arun Rajkumar"
      ],
      "syllabus": null,
      "duration": null,
      "schedule": null,
      "url": "https://nptel.ac.in/courses/106106236",
      "available_sections": [
        "about",
        "course",
        "downloads",
        "TA list",
        "statistics",
        "toppers list",
        "certificate type",
        "Syllabus"
      ],
      "fields_unavailable": [
        "discipline",
        "syllabus",
        "duration",
        "schedule"
      ],
      "enrichment": "skipped",
      "enrichment_error": null
    },
    {
      "course_id": "106106213",
      "title": "NOC: Practical Machine Learning with Tensorflow",
      "institute": "IIT Madras & Google",
      "discipline": null,
      "instructors": [
        "Prof. Ashish Tendulkar",
        "Prof. Balaraman Ravindran"
      ],
      "syllabus": null,
      "duration": null,
      "schedule": null,
      "url": "https://nptel.ac.in/courses/106106213",
      "available_sections": [
        "about",
        "course",
        "downloads",
        "TA list",
        "statistics",
        "toppers list",
        "certificate type",
        "Syllabus"
      ],
      "fields_unavailable": [
        "discipline",
        "syllabus",
        "duration",
        "schedule"
      ],
      "enrichment": "skipped",
      "enrichment_error": null
    }
  ],
  "fields": [
    {
      "field": "title",
      "values": {
        "106106139": "NOC: Introduction to Machine Learning",
        "106106213": "NOC: Practical Machine Learning with Tensorflow",
        "106106236": "NOC: Introduction to Machine Learning (Tamil)"
      },
      "differs": true
    },
    {
      "field": "institute",
      "values": {
        "106106139": "IIT Madras",
        "106106213": "IIT Madras & Google",
        "106106236": "IIT Madras"
      },
      "differs": true
    },
    {
      "field": "discipline",
      "values": {
        "106106139": null,
        "106106213": null,
        "106106236": null
      },
      "differs": false
    },
    {
      "field": "instructors",
      "values": {
        "106106139": "Prof. Balaraman Ravindran",
        "106106213": "Prof. Ashish Tendulkar; Prof. Balaraman Ravindran",
        "106106236": "Prof. Arun Rajkumar"
      },
      "differs": true
    },
    {
      "field": "duration",
      "values": {
        "106106139": null,
        "106106213": null,
        "106106236": null
      },
      "differs": false
    },
    {
      "field": "schedule",
      "values": {
        "106106139": null,
        "106106213": null,
        "106106236": null
      },
      "differs": false
    },
    {
      "field": "syllabus",
      "values": {
        "106106139": null,
        "106106213": null,
        "106106236": null
      },
      "differs": false
    }
  ],
  "summary": "Compared 3 courses. Differing fields: title, institute, instructors. Unavailable for all of them (enrich=false skips duration/schedule/syllabus): discipline, duration, schedule, syllabus."
}

>>> get_course {"course_id":"000000000"}
<<< ERROR (4.0s)
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No NPTEL course with id 000000000 (site returned HTTP 500)",
    "tool": "get_course",
    "field": null
  }
}

```
