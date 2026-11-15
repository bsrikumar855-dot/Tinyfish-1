# Demo transcript

This is a **real run** (2026-11-15) of the built server (`dist/server.js`) driven over stdio by a real MCP client (`scripts/demo.ts`, using `@modelcontextprotocol/sdk`). It is **not** a Claude chat: no LLM was in the loop, the calls are the search -> get -> compare chain an agent would make, each argument taken from the previous result. Reproduce with `npm run build && npx tsx scripts/demo.ts`. All calls used `refresh: true` (cache bypassed) except the last.

```
TOOLS: search_courses, get_course, list_institutes, compare_courses 

>>> search_courses {"query":"machine learning","institute":"IIT Madras","limit":3,"refresh":true}
<<< (4.3s)
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
<<< (2.5s)
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
  ]
}

>>> compare_courses {"course_ids":["106106139","106106236","106106213"],"refresh":true}
<<< (1.3s)
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
      ]
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
      ]
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
      ]
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
  "summary": "Compared 3 courses. Differing fields: title, institute, instructors. Not shown on NPTEL for any of them: discipline, duration, schedule, syllabus."
}

>>> get_course {"course_id":"000000000"}
<<< ERROR (4.4s)
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No NPTEL course with id 000000000 (site returned HTTP 500)",
    "tool": "get_course",
    "field": null
  }
}

```
