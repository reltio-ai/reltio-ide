## ADDED Requirements

### Requirement: Diagram text does not overlap anything else drawn
The preview SHALL lay a process out so that no text it draws overlaps another element's text or shape.

#### Scenario: A caption below a shape has room reserved for it
- **WHEN** a process contains an event or gateway whose name is wider or taller than the shape
- **THEN** the layout SHALL reserve space for that name when positioning neighbouring elements
- **AND** the name SHALL NOT be drawn over any other shape or caption

#### Scenario: A condition is drawn clear of the gateway it leaves
- **WHEN** a gateway fans out on conditional flows
- **THEN** each condition SHALL be drawn beside its own connector
- **AND** SHALL NOT be drawn over the gateway or any other shape

#### Scenario: Conditions do not collide with each other
- **WHEN** two conditional flows leave the same gateway
- **THEN** their two conditions SHALL occupy disjoint regions

### Requirement: Space reserved for text does not change the file
Room reserved for labels during layout SHALL NOT affect the diagram information written to disk.

#### Scenario: Shapes keep their BPMN default sizes
- **WHEN** the extension generates a diagram section for a process
- **THEN** each event SHALL be recorded as 36x36, each gateway as 50x50 and each task as 100x80
- **AND** the recorded sizes SHALL be independent of how long the element's name is

#### Scenario: Connectors still meet their shapes
- **WHEN** a route is generated between two elements
- **THEN** each end of the route SHALL terminate on the boundary of the shape it connects
- **AND** the route SHALL remain orthogonal

### Requirement: Labels are fitted to the space available
A label SHALL be wrapped and, only if still too wide, shortened — using the width it actually has rather than a fixed character count.

#### Scenario: A task name uses both available lines
- **WHEN** a task's name does not fit on one line inside the shape
- **THEN** it SHALL wrap to a second line within the shape's width
- **AND** the name and any detail line SHALL both remain inside the shape

#### Scenario: A name that cannot wrap is shortened
- **WHEN** a single word is wider than the space available
- **THEN** it SHALL be shortened with an ellipsis to fit that space

#### Scenario: Shortened text is still recoverable
- **WHEN** a label has been wrapped or shortened
- **THEN** the element's hover SHALL show the full untruncated value

#### Scenario: An unnamed element takes no extra space
- **WHEN** an element has no name
- **THEN** no caption space SHALL be reserved for it

#### Scenario: Fitting the view shows every label
- **WHEN** the user fits the diagram to the window
- **THEN** no caption SHALL be clipped at any edge, including captions wider than the shape they describe

### Requirement: Layout and rendering agree on label size
The component that reserves space for a label and the component that draws it SHALL derive both the text and its size from one shared definition.

#### Scenario: The drawn text is the measured text
- **WHEN** the layout reserves space for a label
- **THEN** the renderer SHALL draw exactly the lines that measurement produced
