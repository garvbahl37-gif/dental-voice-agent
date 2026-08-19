/**
 * The practice, in the depth a receptionist actually carries in her head.
 *
 * A thin seed makes an agent sound thin. Asked "which doctor should I see for
 * my daughter's braces, and what will it cost?", an agent with three names and
 * a price range has to deflect; one that knows Dr. Mehta did his MDS in
 * orthodontics at Nair, works Bandra on Mondays and Andheri on Thursdays,
 * speaks Marathi, and is good with nervous teenagers can simply answer.
 *
 * Everything here is grounded: the knowledge tool answers *only* from this
 * file, so richness here is the difference between a useful answer and an
 * invented one.
 */

export interface Branch {
  id: string
  name: string
  area: string
  address: string
  landmark: string
  phone: string
  hours: string
  sunday: string
  parking: string
  transport: string
  chairs: number
  facilities: string[]
}

export interface Doctor {
  id: string
  name: string
  title: string
  qualifications: string
  registration: string
  experienceYears: number
  specialties: string[]
  languages: string[]
  branches: string[]
  /** Weekday indices worked, 0 = Sunday. */
  days: number[]
  startHour: number
  endHour: number
  /** What the front desk would actually tell a caller about them. */
  note: string
  consultFee: number
}

export interface TreatmentInfo {
  serviceId: string
  name: string
  alsoCalled: string[]
  whatItIs: string
  sittings: string
  durationMin: number
  priceMin: number
  priceMax: number
  anaesthesia: string
  aftercare: string
  recovery: string
  cashless: boolean
}

// ─── Branches ────────────────────────────────────────────────────────────────

export const BRANCHES: Branch[] = [
  {
    id: 'b1',
    name: 'Smile Dental Care — Bandra West',
    area: 'Bandra West',
    address: '2nd floor, Sunrise Chambers, Linking Road, Bandra West, Mumbai 400050',
    landmark: 'above the HDFC Bank, opposite the Nike showroom',
    phone: '02226551200',
    hours: 'Monday to Saturday, nine in the morning to seven in the evening',
    sunday: 'closed',
    parking: 'paid parking in the building basement, about forty rupees an hour',
    transport: 'two minutes walk from Bandra station west exit',
    chairs: 4,
    facilities: [
      'digital OPG and intraoral X-ray on site',
      'in-house dental laboratory for same-day crowns',
      'separate paediatric room',
      'wheelchair accessible with a lift',
    ],
  },
  {
    id: 'b2',
    name: 'Smile Dental Care — Andheri West',
    area: 'Andheri West',
    address: 'Shop 4, Veera Desai Road, Andheri West, Mumbai 400053',
    landmark: 'next to the Cafe Coffee Day, near Fun Republic',
    phone: '02226551300',
    hours: 'Monday to Saturday, ten in the morning to eight in the evening',
    sunday: 'ten to two, emergencies only',
    parking: 'street parking, usually easy after eleven',
    transport: 'ten minutes from Andheri metro, auto from the station',
    chairs: 3,
    facilities: [
      'digital X-ray on site',
      'implant surgery suite',
      'Sunday morning emergency cover',
    ],
  },
  {
    id: 'b3',
    name: 'Smile Dental Care — Powai',
    area: 'Powai',
    address: 'Unit 7, Galleria Shopping Centre, Hiranandani Gardens, Powai, Mumbai 400076',
    landmark: 'inside Galleria, first floor, near the bookstore',
    phone: '02226551400',
    hours: 'Monday to Saturday, ten in the morning to seven in the evening',
    sunday: 'closed',
    parking: 'free parking in the Galleria lot for the first two hours',
    transport: 'buses from Vikhroli and Kanjurmarg stop outside Galleria',
    chairs: 2,
    facilities: ['digital X-ray on site', 'orthodontics and aligner scanning'],
  },
]

// ─── Doctors ─────────────────────────────────────────────────────────────────

export const DOCTORS: Doctor[] = [
  {
    id: 'p1',
    name: 'Dr. Ananya Sharma',
    title: 'Senior Dental Surgeon and Clinical Director',
    qualifications: 'BDS from Government Dental College Mumbai, MDS in Conservative Dentistry and Endodontics from Nair Hospital Dental College',
    registration: 'Maharashtra State Dental Council A-14283',
    experienceYears: 16,
    specialties: ['root canal treatment', 'crowns and bridges', 'general dentistry', 'smile design'],
    languages: ['English', 'Hindi', 'Marathi'],
    branches: ['b1', 'b3'],
    days: [1, 2, 3, 4, 5],
    startHour: 9,
    endHour: 18,
    note: 'Our senior-most doctor and the one most patients ask for. Very good with anxious patients and takes her time explaining things. Does single-sitting root canals.',
    consultFee: 800,
  },
  {
    id: 'p2',
    name: 'Dr. Rohan Mehta',
    title: 'Consultant Orthodontist',
    qualifications: 'BDS from Nair Hospital Dental College, MDS in Orthodontics and Dentofacial Orthopaedics from KLE Belgaum',
    registration: 'Maharashtra State Dental Council A-19047',
    experienceYears: 11,
    specialties: ['braces', 'clear aligners', 'Invisalign', 'jaw alignment', 'teen orthodontics'],
    languages: ['English', 'Hindi', 'Gujarati'],
    branches: ['b1', 'b2', 'b3'],
    days: [1, 3, 5, 6],
    startHour: 10,
    endHour: 19,
    note: 'Handles all our braces and aligner cases. Especially good with teenagers who do not want visible braces. Certified Invisalign provider.',
    consultFee: 1000,
  },
  {
    id: 'p3',
    name: 'Dr. Kavita Iyer',
    title: 'Consultant Periodontist and Implantologist',
    qualifications: 'BDS from Manipal College of Dental Sciences, MDS in Periodontology, Fellowship in Oral Implantology from ICOI',
    registration: 'Maharashtra State Dental Council A-16620',
    experienceYears: 13,
    specialties: ['gum treatment', 'deep cleaning', 'dental implants', 'wisdom tooth surgery', 'gum grafting'],
    languages: ['English', 'Hindi', 'Tamil', 'Malayalam'],
    branches: ['b1', 'b2'],
    days: [2, 4, 5, 6],
    startHour: 9,
    endHour: 17,
    note: 'Does all our surgical work and implants. If someone has bleeding gums or loose teeth, she is the one to see.',
    consultFee: 900,
  },
  {
    id: 'p4',
    name: 'Dr. Farhan Qureshi',
    title: 'Paediatric Dentist',
    qualifications: 'BDS from Dr. D. Y. Patil Dental College, MDS in Paedodontics and Preventive Dentistry',
    registration: 'Maharashtra State Dental Council A-21155',
    experienceYears: 8,
    specialties: ['children', 'first dental visits', 'fluoride and sealants', 'habit correction', 'milk tooth extraction'],
    languages: ['English', 'Hindi', 'Urdu'],
    branches: ['b1', 'b2'],
    days: [1, 2, 4, 6],
    startHour: 10,
    endHour: 17,
    note: 'Sees children from about two years old. Very patient with frightened kids — first visits with him are usually just a ride in the chair and a count of the teeth.',
    consultFee: 700,
  },
  {
    id: 'p5',
    name: 'Dr. Meera Nair',
    title: 'Prosthodontist',
    qualifications: 'BDS from SDM Dharwad, MDS in Prosthodontics and Crown and Bridge',
    registration: 'Maharashtra State Dental Council A-18332',
    experienceYears: 10,
    specialties: ['dentures', 'full mouth rehabilitation', 'veneers', 'teeth whitening', 'crowns'],
    languages: ['English', 'Hindi', 'Malayalam'],
    branches: ['b1', 'b3'],
    days: [2, 3, 5],
    startHour: 11,
    endHour: 19,
    note: 'Does our cosmetic work and dentures. Handles the same-day crown cases using the in-house lab at Bandra.',
    consultFee: 900,
  },
  {
    id: 'p6',
    name: 'Dr. Sanjay Deshpande',
    title: 'Oral and Maxillofacial Surgeon (visiting)',
    qualifications: 'BDS, MDS in Oral and Maxillofacial Surgery from Nair Hospital, Fellowship in Facial Trauma',
    registration: 'Maharashtra State Dental Council A-12907',
    experienceYears: 19,
    specialties: ['impacted wisdom teeth', 'jaw surgery', 'facial trauma', 'complex extractions', 'cysts'],
    languages: ['English', 'Hindi', 'Marathi'],
    branches: ['b2'],
    days: [3, 6],
    startHour: 11,
    endHour: 16,
    note: 'Visits Andheri on Wednesdays and Saturdays. We refer difficult wisdom teeth and any jaw surgery to him. Appointments with him need to be booked in advance.',
    consultFee: 1500,
  },
]

// ─── Treatments ──────────────────────────────────────────────────────────────

export const TREATMENTS: TreatmentInfo[] = [
  {
    serviceId: 's1', name: 'Consultation', alsoCalled: ['checkup', 'check-up', 'first visit', 'opinion'],
    whatItIs: 'A full examination, X-ray if needed, and a written treatment plan with costs before anything is started.',
    sittings: 'one', durationMin: 20, priceMin: 500, priceMax: 1500,
    anaesthesia: 'none', aftercare: 'none', recovery: 'none',
    cashless: false,
  },
  {
    serviceId: 's2', name: 'Scaling & Polishing', alsoCalled: ['cleaning', 'safai', 'scaling', 'descaling'],
    whatItIs: 'Ultrasonic removal of tartar and stains above and just below the gumline, then a polish. Recommended every six months.',
    sittings: 'one', durationMin: 30, priceMin: 1500, priceMax: 2500,
    anaesthesia: 'usually none; local gel if the gums are very sensitive',
    aftercare: 'avoid very hot or cold food for a day; mild sensitivity for two to three days is normal',
    recovery: 'none, you can eat straight after', cashless: false,
  },
  {
    serviceId: 's3', name: 'Composite Filling', alsoCalled: ['filling', 'cavity', 'bharna'],
    whatItIs: 'Decay is removed and the tooth rebuilt with tooth-coloured composite, matched to the shade of your other teeth.',
    sittings: 'one', durationMin: 45, priceMin: 1200, priceMax: 3000,
    anaesthesia: 'local anaesthetic injection',
    aftercare: 'avoid chewing on that side for a couple of hours until the numbness goes',
    recovery: 'same day', cashless: true,
  },
  {
    serviceId: 's4', name: 'Root Canal', alsoCalled: ['RCT', 'root canal treatment', 'nerve treatment'],
    whatItIs: 'The infected nerve is removed, the canals cleaned and sealed, and the tooth is then capped with a crown to protect it.',
    sittings: 'usually one sitting with Dr. Sharma; sometimes two if there is active infection',
    durationMin: 90, priceMin: 6000, priceMax: 12000,
    anaesthesia: 'local anaesthetic; the procedure itself is not painful',
    aftercare: 'soft food for a day; mild tenderness on biting for two to three days is normal',
    recovery: 'back to normal next day; the crown is fitted about a week later', cashless: true,
  },
  {
    serviceId: 's5', name: 'Crown Fitting', alsoCalled: ['crown', 'cap', 'capping'],
    whatItIs: 'A cap fitted over a weak or root-treated tooth. We do metal-ceramic, full ceramic and zirconia.',
    sittings: 'two, about a week apart; same-day possible at Bandra using the in-house lab',
    durationMin: 60, priceMin: 8000, priceMax: 20000,
    anaesthesia: 'local anaesthetic for the preparation visit',
    aftercare: 'avoid very hard or sticky food for the first day after fitting',
    recovery: 'same day', cashless: true,
  },
  {
    serviceId: 's6', name: 'Tooth Extraction', alsoCalled: ['extraction', 'tooth removal', 'daant nikalna'],
    whatItIs: 'A simple removal of a tooth that cannot be saved.',
    sittings: 'one', durationMin: 45, priceMin: 2000, priceMax: 5000,
    anaesthesia: 'local anaesthetic',
    aftercare: 'bite on the gauze for half an hour, cold soft food for the day, no rinsing hard or straws for twenty four hours, no smoking',
    recovery: 'two to three days', cashless: true,
  },
  {
    serviceId: 's7', name: 'Wisdom Tooth Surgery', alsoCalled: ['wisdom tooth', 'akal daadh', 'third molar'],
    whatItIs: 'Surgical removal of an impacted wisdom tooth, usually with Dr. Iyer, or Dr. Deshpande for difficult cases.',
    sittings: 'one', durationMin: 90, priceMin: 12000, priceMax: 25000,
    anaesthesia: 'local anaesthetic; sedation can be arranged if you are very anxious',
    aftercare: 'ice pack for the first day, soft cold food, keep the area clean; swelling peaks on day two and settles by day four',
    recovery: 'three to five days, take the day off', cashless: true,
  },
  {
    serviceId: 's8', name: 'Teeth Whitening', alsoCalled: ['whitening', 'bleaching', 'teeth cleaning white'],
    whatItIs: 'In-chair whitening with a light-activated gel, or a take-home kit with custom trays.',
    sittings: 'one in chair, or two weeks at home', durationMin: 60, priceMin: 8000, priceMax: 15000,
    anaesthesia: 'none',
    aftercare: 'no tea, coffee, red wine, or coloured food for forty eight hours',
    recovery: 'none; some sensitivity for a day or two', cashless: false,
  },
  {
    serviceId: 's9', name: 'Braces Consultation', alsoCalled: ['braces', 'aligners', 'Invisalign', 'teeth straightening'],
    whatItIs: 'Assessment with photos, X-rays and a scan, followed by a plan and quote for braces or aligners.',
    sittings: 'one', durationMin: 30, priceMin: 800, priceMax: 1000,
    anaesthesia: 'none', aftercare: 'none', recovery: 'none', cashless: false,
  },
  {
    serviceId: 's10', name: 'Braces Adjustment', alsoCalled: ['tightening', 'wire change', 'adjustment'],
    whatItIs: 'Routine monthly adjustment for patients already in treatment.',
    sittings: 'monthly', durationMin: 30, priceMin: 1500, priceMax: 2500,
    anaesthesia: 'none',
    aftercare: 'soft food for a day; some soreness for two to three days after tightening',
    recovery: 'none', cashless: false,
  },
  {
    serviceId: 's11', name: 'Denture Fitting', alsoCalled: ['dentures', 'false teeth', 'implant'],
    whatItIs: 'Complete or partial dentures, or implant-supported teeth with Dr. Iyer and Dr. Nair.',
    sittings: 'four to five visits over three to four weeks',
    durationMin: 60, priceMin: 15000, priceMax: 40000,
    anaesthesia: 'none for dentures; local anaesthetic for implants',
    aftercare: 'soft food while you get used to them; a follow-up for adjustment is normal and included',
    recovery: 'a week or two to adjust', cashless: true,
  },
  {
    serviceId: 's12', name: 'Emergency Visit', alsoCalled: ['emergency', 'urgent', 'pain'],
    whatItIs: 'Same-day assessment and pain relief. We keep slots free every morning for emergencies.',
    sittings: 'one', durationMin: 30, priceMin: 1000, priceMax: 2000,
    anaesthesia: 'as needed', aftercare: 'depends on treatment', recovery: 'varies', cashless: true,
  },
]

// ─── Practice policies ───────────────────────────────────────────────────────

export const INSURERS_CASHLESS = [
  'Star Health', 'HDFC Ergo', 'Bajaj Allianz', 'Niva Bupa', 'ICICI Lombard',
]

export const PAYMENT = {
  methods: 'cash, all cards, UPI, and net banking',
  emi: 'no-cost EMI over three, six or nine months on treatments above twenty thousand rupees, through HDFC and Bajaj Finserv',
  deposit: 'no deposit for a normal appointment; twenty per cent advance for implants and full mouth work',
  gst: 'dental treatment is exempt from GST, so the quoted price is what you pay',
}

export const POLICIES = {
  cancellation: 'no charge if you tell us at least twenty four hours before. Same-day cancellations we just note down. After three no-shows we ask for a small advance to hold the next appointment.',
  lateness: 'we hold your slot for fifteen minutes; after that we may need to reschedule you, depending on the day.',
  firstVisit: 'bring any previous X-rays or reports and your insurance card. Come ten minutes early the first time so we can take your details.',
  children: 'we see children from about two years old with Dr. Qureshi. First visits are kept short and easy — usually just a look and a count of the teeth.',
  emergency: 'we keep slots free every morning at all branches for emergencies, and there is an on-call dentist outside working hours on the Bandra number.',
  sterilisation: 'every instrument goes through autoclave sterilisation with cycle records kept, we use single-use disposables wherever possible, and chairs are wiped down between patients.',
  records: 'we keep digital records and can email your X-rays and treatment notes on request.',
  secondOpinion: 'yes, second opinions are welcome. Bring whatever X-rays or quotes you already have and we will go through them with you.',
}
